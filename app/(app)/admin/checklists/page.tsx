import Link from 'next/link'
import { ConfirmButton } from '@/app/components/confirm-button'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import { voidEntry } from '@/app/(app)/checklist/actions'
import { requireAdmin } from '@/lib/auth'
import { PHASES, PHASE_LABEL, TYPE_LABEL, formatValue, loadChecklist, progress } from '@/lib/checklist'
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

  const [{ items, entries, names, photoUrls }, { data: salesData }] = await Promise.all([
    loadChecklist(supabase, date),
    supabase.from('sales_reports').select(SALES_SELECT).eq('work_date', date).order('submitted_at'),
  ])
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
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      {PHASES.map((phase) => {
        const p = progress(items, entries, phase)
        return (
          <section key={phase} style={{ marginTop: 16 }}>
            <h2>
              {PHASE_LABEL[phase]}{' '}
              <span
                style={{ fontSize: 16, color: p.requiredDone === p.requiredTotal ? 'var(--success)' : 'var(--danger)' }}
              >
                필수 {p.requiredDone}/{p.requiredTotal}
              </span>{' '}
              <span className="small muted">
                (전체 {p.allDone}/{p.allTotal})
              </span>
            </h2>
            <div className="table-wrap">
              <table>
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
                          style={
                            !done && item.is_required && item.is_active ? { background: 'var(--danger-bg)' } : undefined
                          }
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
                              <strong style={{ color: item.is_required ? 'var(--danger)' : 'var(--faint)' }}>
                                미완료
                              </strong>
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
                            {done?.note && <div className="small muted">메모: {done.note}</div>}
                            {done && (
                              <details>
                                <summary style={{ fontSize: 12 }}>취소</summary>
                                <form action={voidEntry}>
                                  <input type="hidden" name="entry_id" value={done.id} />
                                  <input type="hidden" name="back" value={back} />
                                  <input name="reason" required placeholder="사유" size={10} />{' '}
                                  <ConfirmButton message="이 체크를 취소할까요? (기록에는 남습니다)">
                                    취소
                                  </ConfirmButton>
                                </form>
                              </details>
                            )}
                          </td>
                          <td>{done ? (names[done.done_by] ?? '?') : '-'}</td>
                          <td>{done ? formatDateTime(done.done_at) : '-'}</td>
                          <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {voided.map((v) => (
                              <div key={v.id}>
                                {names[v.done_by] ?? '?'} {formatTime(v.done_at)} 체크
                                {v.value_number !== null && `(${formatValue(item, v)})`} →{' '}
                                {names[v.voided_by ?? ''] ?? '?'} {formatTime(v.voided_at)} 취소: {v.void_reason}
                              </div>
                            ))}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
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
              className="card"
              style={{ padding: 12, margin: '0 0 8px', color: s.status === 'void' ? 'var(--faint)' : undefined }}
            >
              {s.status === 'void' && <strong>[무효: {s.void_reason}] </strong>}
              매출 {formatWon(s.total_sales)} · 카드 {formatWon(s.card_amount)} · 현금 {formatWon(s.cash_amount)} · 기타{' '}
              {formatWon(s.other_amount)}
              {diff !== 0 && <strong className="text-danger"> · 차이 {formatWon(diff)}</strong>} · 현금 지출{' '}
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
        <p>
          <Link href="/admin/checklist-items">⚙️ 체크리스트 항목 설정 (추가 · 수정 · 순서 · 사용 중지)</Link>
        </p>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/checklist">▶ 오늘 체크리스트 화면</Link>
      </p>
    </main>
  )
}
