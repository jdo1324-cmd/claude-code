import Link from 'next/link'
import { ConfirmButton } from '@/app/components/confirm-button'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import { addItem, setItemActive, voidEntry } from '@/app/(app)/checklist/actions'
import { requireAdmin } from '@/lib/auth'
import {
  PHASES,
  PHASE_LABEL,
  TYPE_LABEL,
  formatValue,
  loadChecklist,
  progress,
  type ChecklistItem,
} from '@/lib/checklist'
import { formatTime, todayKST } from '@/lib/format'
import { SALES_SELECT, formatWon, paymentDiff, type SalesReport } from '@/lib/sales'
import { createClient } from '@/lib/supabase/server'

function formatDateTime(iso: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

export default async function ChecklistHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string; ok?: string }>
}) {
  const { date: dateParam, error, ok } = await searchParams
  const me = await requireAdmin()
  const isOwner = me.role === 'owner'
  const today = todayKST()
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today
  const back = `/admin/checklists?date=${date}`
  const supabase = await createClient()

  const [{ items, entries, names, photoUrls }, { data: allItemData }, { data: salesData }] = await Promise.all([
    loadChecklist(supabase, date),
    isOwner
      ? supabase.from('checklist_items').select('*').order('phase').order('sort_order')
      : Promise.resolve({ data: [] }),
    supabase.from('sales_reports').select(SALES_SELECT).eq('work_date', date).order('submitted_at'),
  ])
  const allItems = (allItemData ?? []) as ChecklistItem[]
  const reports = (salesData ?? []) as unknown as SalesReport[]
  const itemById = new Map(items.map((i) => [i.id, i]))

  // 시간순 기록: 체크 + 취소
  const timeline = [
    ...entries.map((e) => ({ at: e.done_at, who: e.done_by, entry: e, kind: '완료' as const })),
    ...entries
      .filter((e) => e.status === 'void' && e.voided_at)
      .map((e) => ({ at: e.voided_at!, who: e.voided_by ?? '', entry: e, kind: '취소' as const })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <main>
      {date === today && <RealtimeRefresh table="checklist_entries" filter={`work_date=eq.${date}`} />}
      <h1>체크리스트 기록</h1>
      <form method="get">
        <input type="date" name="date" defaultValue={date} /> <button type="submit">보기</button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {ok && <p style={{ color: 'green' }}>{ok}</p>}

      {PHASES.map((phase) => {
        const p = progress(items, entries, phase)
        return (
          <section key={phase} style={{ marginTop: 16 }}>
            <h2>
              {PHASE_LABEL[phase]}{' '}
              <span style={{ fontSize: 16, color: p.requiredDone === p.requiredTotal ? 'green' : 'crimson' }}>
                필수 {p.requiredDone}/{p.requiredTotal}
              </span>{' '}
              <span style={{ fontSize: 14, color: '#666' }}>(전체 {p.allDone}/{p.allTotal})</span>
            </h2>
            <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>업무</th>
                  <th>항목</th>
                  <th>구분</th>
                  <th>결과</th>
                  <th>한 사람</th>
                  <th>시각</th>
                  <th>취소 내역</th>
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((i) => i.phase === phase)
                  .map((item) => {
                    const done = entries.find((e) => e.item_id === item.id && e.status === 'valid')
                    const voided = entries.filter((e) => e.item_id === item.id && e.status === 'void')
                    return (
                      <tr
                        key={item.id}
                        style={!done && item.is_required && item.is_active ? { background: '#fee' } : undefined}
                      >
                        <td>{item.category}</td>
                        <td>
                          {item.title}
                          {!item.is_active && ' (사용 중지됨)'}
                        </td>
                        <td>
                          {item.is_required ? '필수' : '선택'} · {TYPE_LABEL[item.item_type]}
                        </td>
                        <td>
                          {!done ? (
                            <strong style={{ color: item.is_required ? 'crimson' : '#888' }}>미완료</strong>
                          ) : item.item_type === 'number' ? (
                            formatValue(item, done)
                          ) : item.item_type === 'photo' && done.photo_path && photoUrls[done.photo_path] ? (
                            <a href={photoUrls[done.photo_path]} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={photoUrls[done.photo_path]} alt={item.title} style={{ height: 60 }} />
                            </a>
                          ) : (
                            '완료'
                          )}
                          {done?.note && <div style={{ fontSize: 12 }}>메모: {done.note}</div>}
                          {done && (
                            <details>
                              <summary style={{ fontSize: 12 }}>취소</summary>
                              <form action={voidEntry}>
                                <input type="hidden" name="entry_id" value={done.id} />
                                <input type="hidden" name="back" value={back} />
                                <input name="reason" required placeholder="사유" size={10} />{' '}
                                <ConfirmButton message="이 체크를 취소할까요? (기록에는 남습니다)">취소</ConfirmButton>
                              </form>
                            </details>
                          )}
                        </td>
                        <td>{done ? names[done.done_by] ?? '?' : '-'}</td>
                        <td>{done ? formatDateTime(done.done_at) : '-'}</td>
                        <td style={{ fontSize: 12, color: '#777' }}>
                          {voided.map((v) => (
                            <div key={v.id}>
                              {names[v.done_by] ?? '?'} {formatTime(v.done_at)} 체크
                              {v.value_number !== null && `(${formatValue(item, v)})`} → {names[v.voided_by ?? ''] ?? '?'}{' '}
                              {formatTime(v.voided_at)} 취소: {v.void_reason}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </section>
        )
      })}

      <section style={{ marginTop: 24 }}>
        <h2>매출 정산 보고서</h2>
        {reports.length === 0 && <p>이 날짜에 제출된 보고서가 없습니다.</p>}
        {reports.map((s) => {
          const diff = paymentDiff(s)
          return (
            <div
              key={s.id}
              style={{ border: '1px solid #ccc', padding: 8, marginBottom: 8, color: s.status === 'void' ? '#999' : undefined }}
            >
              {s.status === 'void' && <strong>[무효: {s.void_reason}] </strong>}
              매출 {formatWon(s.total_sales)} · 카드 {formatWon(s.card_amount)} · 현금 {formatWon(s.cash_amount)} ·
              기타 {formatWon(s.other_amount)}
              {diff !== 0 && <strong style={{ color: 'crimson' }}> · 차이 {formatWon(diff)}</strong>} · 현금 지출{' '}
              {formatWon(s.cash_expense)} · 체크카드 지출 {formatWon(s.check_card_expense)}
              {s.note && ` · 메모: ${s.note}`} — {names[s.submitted_by] ?? '?'} {formatDateTime(s.submitted_at)}
            </div>
          )
        })}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>시간순 기록 (누가 언제 무엇을)</h2>
        <ul>
          {timeline.map((t, i) => {
            const item = itemById.get(t.entry.item_id)
            return (
              <li key={i}>
                {formatDateTime(t.at)} — <strong>{names[t.who] ?? '?'}</strong> —{' '}
                {item ? `[${PHASE_LABEL[item.phase]}] ${item.title}` : '?'}{' '}
                {t.kind === '완료'
                  ? `완료${item && t.entry.value_number !== null ? ` (${formatValue(item, t.entry)})` : ''}${
                      t.entry.photo_path ? ' (사진)' : ''
                    }`
                  : `취소 (사유: ${t.entry.void_reason})`}
              </li>
            )
          })}
          {timeline.length === 0 && <li>기록이 없습니다.</li>}
        </ul>
      </section>

      {isOwner && (
        <section style={{ marginTop: 24, borderTop: '1px solid #ccc', paddingTop: 8 }}>
          <h2>체크리스트 항목 관리 (사장)</h2>
          <p>
            항목은 지우지 않고 &quot;사용 중지&quot;합니다(지난 기록 보존). 이름을 바꾸려면 새 항목을 추가하고 기존
            항목을 사용 중지하세요.
          </p>
          <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>구분</th>
                <th>업무</th>
                <th>항목</th>
                <th>종류</th>
                <th>필수</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {allItems.map((item) => (
                <tr key={item.id} style={item.is_active ? undefined : { color: '#999' }}>
                  <td>{PHASE_LABEL[item.phase]}</td>
                  <td>{item.category}</td>
                  <td>{item.title}</td>
                  <td>
                    {TYPE_LABEL[item.item_type]}
                    {item.unit && ` (${item.unit})`}
                  </td>
                  <td>{item.is_required ? '필수' : '선택'}</td>
                  <td>
                    <form action={setItemActive}>
                      <input type="hidden" name="item_id" value={item.id} />
                      <input type="hidden" name="active" value={item.is_active ? '0' : '1'} />
                      <input type="hidden" name="back" value={back} />
                      {item.is_active ? '사용 중 ' : '중지 '}
                      <button type="submit">{item.is_active ? '사용 중지' : '다시 사용'}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>항목 추가</h3>
          <form action={addItem}>
            <input type="hidden" name="back" value={back} />
            <select name="phase" defaultValue="open">
              <option value="open">오픈 업무</option>
              <option value="close">마감 업무</option>
            </select>{' '}
            업무 <input name="category" required placeholder="예: 매장 오픈" size={10} /> 항목{' '}
            <input name="title" required placeholder="예: 정수기 필터 확인" size={14} />{' '}
            <select name="item_type" defaultValue="check">
              <option value="check">✔ 체크</option>
              <option value="number">🔢 숫자 입력</option>
              <option value="photo">📷 사진 필수</option>
            </select>{' '}
            단위(숫자만) <input name="unit" placeholder="℃" size={4} />{' '}
            <label>
              <input type="checkbox" name="is_required" defaultChecked /> 필수
            </label>{' '}
            <button type="submit">추가</button>
          </form>
        </section>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/checklist">▶ 오늘 체크리스트 화면</Link>
      </p>
    </main>
  )
}
