import Link from 'next/link'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import { requireAdmin, type Profile } from '@/lib/auth'
import { todayKST } from '@/lib/format'
import { RECEIPT_STATUS_LABEL, priceChange, won, type PriceRow, type Receipt } from '@/lib/receipts'
import { createClient } from '@/lib/supabase/server'

const RECEIPT_LIST_SELECT =
  'id, photo_paths, note, created_by, created_at, status, proposal, ai_error, vendor, receipt_date, total_amount, close_reason'

export default async function ReceiptListPage() {
  await requireAdmin()
  const supabase = await createClient()
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [{ data: pendingData }, { data: doneData }, { data: priceData }, { data: profileData }] = await Promise.all([
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
  ])
  const pending = (pendingData ?? []) as unknown as Receipt[]
  const done = (doneData ?? []) as unknown as Receipt[]
  const changes = ((priceData ?? []) as PriceRow[]).filter((p) => Number(p.prev_unit_price) !== Number(p.unit_price))
  const names = Object.fromEntries(((profileData ?? []) as Pick<Profile, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name]))

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
      <td style={{ textAlign: 'right' }}>{won(r.total_amount ?? r.proposal?.total_amount)}</td>
      <td style={{ fontSize: 12 }}>{r.close_reason ?? r.ai_error ?? r.note ?? ''}</td>
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
    </tr>
  )

  return (
    <main>
      <RealtimeRefresh table="receipts" />
      <h1>거래처 전표</h1>
      <p style={{ fontSize: 13 }}>
        AI가 읽은 값은 제안일 뿐입니다. 사진과 대조해 <strong>확정</strong>해야 실제 기록과 단가 비교에 반영됩니다.
        전표는 사장님·관리자만 볼 수 있습니다.
      </p>

      <h2>확인 대기 ({pending.length}건)</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>{head}</thead>
        <tbody>
          {pending.map(row)}
          {pending.length === 0 && (
            <tr>
              <td colSpan={8}>확인할 전표가 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>단가 변동 (최근 60일 확정분)</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
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
                <td style={{ color: change.direction === 'up' ? 'crimson' : 'blue', fontWeight: 'bold' }}>{change.text}</td>
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

      <h2>최근 처리된 전표</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>{head}</thead>
        <tbody>
          {done.map(row)}
          {done.length === 0 && (
            <tr>
              <td colSpan={8}>아직 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: '#888' }}>오늘: {todayKST()}</p>
    </main>
  )
}
