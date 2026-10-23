import Link from 'next/link'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import { requireAdmin, type Profile } from '@/lib/auth'
import { todayKST } from '@/lib/format'
import { RECEIPT_STATUS_LABEL, priceChange, won, type PriceRow, type Receipt } from '@/lib/receipts'
import { createClient } from '@/lib/supabase/server'
import { ConfirmButton } from '@/app/components/confirm-button'
import { sendUnsentToSheet } from './actions'

// 안 적은 전표를 한꺼번에 장부에 적을 때 시간이 걸릴 수 있음
export const maxDuration = 300

const FIX_LABEL = {
  name: '품목명',
  unit: '단위',
  quantity: '수량',
  unit_price: '단가',
  line_total: '금액',
  added: '빠뜨린 줄',
  removed: '없는 줄을 읽음',
} as const

const RECEIPT_LIST_SELECT =
  'id, photo_paths, note, created_by, created_at, status, proposal, ai_error, vendor, receipt_date, total_amount, close_reason'

export default async function ReceiptListPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  await requireAdmin()
  const supabase = await createClient()
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [{ data: pendingData }, { data: doneData }, { data: priceData }, { data: profileData }, { data: exportData }] =
    await Promise.all([
      supabase
        .from('receipts')
        .select(RECEIPT_LIST_SELECT)
        .in('status', ['processing', 'proposed', 'failed'])
        .order('created_at'),
      supabase
        .from('receipts')
        .select(RECEIPT_LIST_SELECT)
        .in('status', ['confirmed', 'rejected', 'void'])
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('receipt_price_history')
        .select('*')
        .gte('receipt_date', since)
        .not('prev_unit_price', 'is', null)
        .order('receipt_date', { ascending: false }),
      supabase.from('profiles').select('id, full_name'),
      supabase.from('receipt_sheet_exports').select('receipt_id'),
    ])
  const sentIds = new Set((exportData ?? []).map((e) => e.receipt_id as number))

  // AI가 읽은 값을 사람이 고친 기록 (최근 60일) → 같은 고침끼리 묶어 많은 순
  const { data: fixData } = await supabase
    .from('receipt_corrections')
    .select('field, ai_value, confirmed_value, item_name, receipt_id')
    .gte('created_at', since)
  const fixRows = (fixData ?? []) as {
    field: keyof typeof FIX_LABEL
    ai_value: string | null
    confirmed_value: string | null
    item_name: string | null
    receipt_id: number
  }[]
  const fixGroups = [
    ...fixRows
      .reduce((m, f) => {
        const key = `${f.field}|${f.item_name}|${f.ai_value}|${f.confirmed_value}`
        const g = m.get(key) ?? { ...f, count: 0 }
        g.count++
        return m.set(key, g)
      }, new Map<string, (typeof fixRows)[number] & { count: number }>())
      .values(),
  ]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
  const fixedReceipts = new Set(fixRows.map((f) => f.receipt_id)).size
  const pending = (pendingData ?? []) as unknown as Receipt[]
  const done = (doneData ?? []) as unknown as Receipt[]
  const changes = ((priceData ?? []) as PriceRow[]).filter((p) => Number(p.prev_unit_price) !== Number(p.unit_price))
  const names = Object.fromEntries(
    ((profileData ?? []) as Pick<Profile, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name]),
  )

  const row = (r: Receipt) => (
    <tr key={r.id}>
      <td>
        <Link href={`/admin/receipts/${r.id}`}>#{r.id}</Link>
      </td>
      <td>{r.created_at.slice(0, 10)}</td>
      <td>{names[r.created_by] ?? '?'}</td>
      <td>{r.photo_paths.length}장</td>
      <td>{RECEIPT_STATUS_LABEL[r.status]}</td>
      <td>{r.vendor ?? r.proposal?.vendor ?? '-'}</td>
      <td className="num">{won(r.total_amount ?? r.proposal?.total_amount)}</td>
      <td className="small">{r.close_reason ?? r.ai_error ?? r.note ?? ''}</td>
      <td>
        {r.status === 'confirmed' ? (
          sentIds.has(r.id) ? (
            <span className="badge badge-ok" style={{ marginLeft: 0 }}>
              적음
            </span>
          ) : (
            <span className="badge" style={{ marginLeft: 0 }}>
              안 적음
            </span>
          )
        ) : (
          '-'
        )}
      </td>
    </tr>
  )
  const head = (
    <tr>
      <th>번호</th>
      <th>올린 날</th>
      <th>올린 사람</th>
      <th>사진</th>
      <th>상태</th>
      <th>거래처</th>
      <th>합계</th>
      <th>메모</th>
      <th>장부</th>
    </tr>
  )

  return (
    <main>
      <RealtimeRefresh table="receipts" />
      <h1>거래처 전표</h1>
      <p className="small muted">
        전표는 <strong>올린 직원이 직접</strong> AI가 읽은 값을 사진과 대조해 확정합니다. 확정하면 매출 매입 장부와
        평균단가에 바로 적힙니다. 사장님·관리자도 여기서 확정·무효 처리할 수 있습니다.
      </p>

      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <h2>확인 대기 ({pending.length}건, 올린 직원이 확정)</h2>
      <div className="table-wrap">
        <table>
          <thead>{head}</thead>
          <tbody>
            {pending.map(row)}
            {pending.length === 0 && (
              <tr>
                <td colSpan={9}>확인할 전표가 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>AI가 자주 틀리는 것 (최근 60일)</h2>
      <p className="small muted">
        직원이 확정하면서 AI가 읽은 값을 고친 곳입니다. 고친 품목명·단위는 다음 전표를 읽을 때 AI에게 알려 주고, 장부
        품목도 지난번 선택대로 먼저 골라 둡니다. 고친 전표 {fixedReceipts}건.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>무엇을</th>
              <th>품목</th>
              <th>AI가 읽은 값</th>
              <th>고친 값</th>
              <th className="num">횟수</th>
            </tr>
          </thead>
          <tbody>
            {fixGroups.map((f) => (
              <tr key={`${f.field}|${f.item_name}|${f.ai_value}|${f.confirmed_value}`}>
                <td>{FIX_LABEL[f.field]}</td>
                <td>{f.item_name ?? '-'}</td>
                <td>{f.ai_value ?? '-'}</td>
                <td>{f.confirmed_value ?? '-'}</td>
                <td className="num">{f.count}번</td>
              </tr>
            ))}
            {fixGroups.length === 0 && (
              <tr>
                <td colSpan={5}>아직 고친 기록이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>단가 변동 (최근 60일 확정분)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>전표 날짜</th>
              <th>품목</th>
              <th>단위</th>
              <th>변동</th>
              <th>지난번</th>
              <th>이번</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((p) => {
              const change = priceChange(p)!
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/admin/receipts/${p.receipt_id}`}>{p.receipt_date}</Link>
                  </td>
                  <td>{p.item_name}</td>
                  <td>{p.unit ?? '-'}</td>
                  <td
                    style={{ color: change.direction === 'up' ? 'var(--danger)' : 'var(--info)', fontWeight: 'bold' }}
                  >
                    {change.text}
                  </td>
                  <td>
                    {p.prev_receipt_date} {p.prev_vendor}
                  </td>
                  <td>{p.vendor}</td>
                </tr>
              )
            })}
            {changes.length === 0 && (
              <tr>
                <td colSpan={6}>단가가 바뀐 품목이 없습니다. (같은 품목이 두 번 이상 확정되어야 비교됩니다)</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>최근 처리된 전표</h2>
        <form action={sendUnsentToSheet}>
          <ConfirmButton message="확정됐지만 아직 장부에 안 적은 전표를 모두 적을까요?">
            📤 안 적은 전표 모두 장부에 적기
          </ConfirmButton>
        </form>
      </div>
      <div className="table-wrap">
        <table>
          <thead>{head}</thead>
          <tbody>
            {done.map(row)}
            {done.length === 0 && (
              <tr>
                <td colSpan={9}>아직 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="small faint">오늘: {todayKST()}</p>
    </main>
  )
}
