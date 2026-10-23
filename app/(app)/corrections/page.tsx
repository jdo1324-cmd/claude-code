import Link from 'next/link'
import { ConfirmButton } from '@/app/components/confirm-button'
import {
  ATTENDANCE_SELECT,
  BREAK_OPTIONS,
  breakLabel,
  isMonth,
  monthRange,
  validBreak,
  type AttendanceRecord,
} from '@/lib/attendance'
import { getCurrentProfile } from '@/lib/auth'
import { CORRECTION_SELECT, REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, type CorrectionRequest } from '@/lib/corrections'
import { formatTime, toKstInput, todayKST } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { cancelCorrection, requestCorrection } from './actions'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function BreakSelect({ defaultValue }: { defaultValue?: number | null }) {
  return (
    <select name="minutes" defaultValue={defaultValue ?? ''}>
      <option value="">변경 없음</option>
      {BREAK_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {breakLabel(m)}
        </option>
      ))}
    </select>
  )
}

function formatProposal(req: CorrectionRequest) {
  if (req.request_type === 'void') return '이 기록을 무효로'
  const parts = [`출근 ${formatTime(req.proposed_clock_in)}`, `퇴근 ${formatTime(req.proposed_clock_out)}`]
  if (req.proposed_break_minutes !== null) parts.push(`휴게 ${breakLabel(req.proposed_break_minutes)}`)
  return parts.join(' · ')
}

// 'YYYY-MM' 에서 n달 이동
function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function kstDate(iso: string | null) {
  return iso ? toKstInput(iso).slice(0, 10) : null
}

export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ attendance_id?: string; add?: string; month?: string; error?: string; ok?: string }>
}) {
  const { attendance_id, add, month: monthParam, error, ok } = await searchParams
  const me = await getCurrentProfile()
  const isPartTime = me.employment_type === 'part_time'
  const today = todayKST()
  const supabase = await createClient()
  const addDate = add && /^\d{4}-\d{2}-\d{2}$/.test(add) && add <= today ? add : null

  // 고른 기록이 있으면 그 기록의 달을 보여 줌
  const { data: selectedData } = attendance_id
    ? await supabase
        .from('attendance')
        .select(ATTENDANCE_SELECT)
        .eq('id', Number(attendance_id))
        .eq('user_id', me.id)
        .eq('status', 'valid')
        .maybeSingle()
    : { data: null }
  const selected = selectedData as unknown as AttendanceRecord | null

  const month = isMonth(monthParam)
    ? monthParam
    : (selected?.work_date.slice(0, 7) ?? addDate?.slice(0, 7) ?? today.slice(0, 7))
  const { start, end } = monthRange(month)

  const [{ data: recordData }, { data: requestData }] = await Promise.all([
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('user_id', me.id)
      .eq('status', 'valid')
      .gte('work_date', start)
      .lte('work_date', end)
      .order('clock_in'),
    supabase
      .from('correction_requests')
      .select(CORRECTION_SELECT)
      .eq('user_id', me.id)
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  const records = (recordData ?? []) as unknown as AttendanceRecord[]
  const requests = (requestData ?? []) as unknown as CorrectionRequest[]

  // 날짜별: 그날 기록, 대기 중인 요청이 있는지
  const recordByDate = new Map(records.map((r) => [r.work_date, r]))
  const pendingDates = new Set<string>()
  for (const q of requests) {
    if (q.status !== 'pending') continue
    const rec = q.attendance_id ? records.find((r) => r.id === q.attendance_id) : undefined
    const date = rec?.work_date ?? kstDate(q.proposed_clock_in)
    if (date) pendingDates.add(date)
  }

  // 달력 칸: 첫 주 앞쪽 빈칸 + 1일 ~ 말일
  const lastDay = Number(end.slice(8))
  const firstWeekday = new Date(`${start}T00:00:00Z`).getUTCDay()
  const cells: (string | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ]
  const nextMonth = shiftMonth(month, 1)
  const [y, m] = month.split('-').map(Number)

  return (
    <main>
      <h1>정정 요청</h1>
      <p className="small muted">
        출퇴근 기록은 직접 고칠 수 없습니다. 정정 요청을 보내면 사장님이나 관리자가 확인 후 승인합니다. 승인되면 원래
        기록은 &quot;무효&quot;로 남고 새 기록이 추가됩니다.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <section>
        <div className="cal-head">
          <Link
            href={`/corrections?month=${shiftMonth(month, -1)}`}
            className="btn btn-secondary icon-btn"
            aria-label="이전 달"
          >
            ◀
          </Link>
          <h2 style={{ margin: 0 }}>
            {y}년 {m}월
          </h2>
          {nextMonth <= today.slice(0, 7) ? (
            <Link href={`/corrections?month=${nextMonth}`} className="btn btn-secondary icon-btn" aria-label="다음 달">
              ▶
            </Link>
          ) : (
            <span className="icon-btn" />
          )}
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>
          정정할 날짜를 누르세요. 기록이 없는 날을 누르면 기록 추가를 요청할 수 있습니다.
        </p>

        <div className="cal" role="grid" aria-label={`${y}년 ${m}월 출퇴근 기록`}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`cal-weekday${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>
              {w}
            </div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`b${i}`} />
            const day = Number(date.slice(8))
            const rec = recordByDate.get(date)
            const future = date > today
            const isSelected = selected?.work_date === date || addDate === date
            const cls = [
              'cal-day',
              rec ? 'has-record' : '',
              pendingDates.has(date) ? 'pending' : '',
              date === today ? 'today' : '',
              isSelected ? 'selected' : '',
            ]
              .filter(Boolean)
              .join(' ')
            const inner = (
              <>
                <span className="cal-num">{day}</span>
                {rec && (
                  <span className="cal-time">
                    {formatTime(rec.clock_in)}
                    <br />
                    {rec.clock_out ? formatTime(rec.clock_out) : '근무 중'}
                  </span>
                )}
                {pendingDates.has(date) && <span className="cal-flag">요청 중</span>}
              </>
            )
            if (future) {
              return (
                <div key={date} className={cls + ' future'}>
                  {inner}
                </div>
              )
            }
            const href = rec ? `/corrections?attendance_id=${rec.id}#form` : `/corrections?add=${date}#form`
            return (
              <Link key={date} href={href} className={cls}>
                {inner}
              </Link>
            )
          })}
        </div>
        <div className="cal-legend small muted">
          <span>
            <i className="dot has-record" /> 출근 기록
          </span>
          <span>
            <i className="dot pending" /> 정정 요청 중
          </span>
          <span>
            <i className="dot today" /> 오늘
          </span>
        </div>
      </section>

      {selected && (
        <section id="form" className="card">
          <h2>{selected.work_date} 기록 정정</h2>
          <p className="alert alert-info">
            지금 기록: 출근 <strong>{formatTime(selected.clock_in)}</strong> · 퇴근{' '}
            <strong>{selected.clock_out ? formatTime(selected.clock_out) : '근무 중'}</strong>
            {selected.auto_clock_out && ' (자동 퇴근 처리)'}
            {isPartTime && ` · 휴게 ${validBreak(selected) === null ? '미입력' : breakLabel(validBreak(selected)!)}`}
          </p>

          <h3>시간 수정 요청</h3>
          <form action={requestCorrection} className="item-fields">
            <input type="hidden" name="type" value="modify" />
            <input type="hidden" name="attendance_id" value={selected.id} />
            <label>
              출근
              <input type="datetime-local" name="clock_in" required defaultValue={toKstInput(selected.clock_in)} />
            </label>
            <label>
              퇴근
              <input type="datetime-local" name="clock_out" defaultValue={toKstInput(selected.clock_out)} />
            </label>
            {isPartTime && (
              <label>
                휴게시간
                <BreakSelect />
              </label>
            )}
            <label>
              사유
              <input name="reason" required placeholder="예: 퇴근 태그를 깜빡함, 실제 퇴근 21:40" />
            </label>
            <div>
              <ConfirmButton message="이 내용으로 정정 요청을 보낼까요?">요청 보내기</ConfirmButton>
            </div>
          </form>

          <details style={{ marginTop: 16 }}>
            <summary>이 날 근무하지 않았어요 (기록 무효 요청)</summary>
            <form action={requestCorrection} className="item-fields">
              <input type="hidden" name="type" value="void" />
              <input type="hidden" name="attendance_id" value={selected.id} />
              <label>
                사유
                <input name="reason" required placeholder="예: 쉬는 날인데 태그를 잘못 찍음" />
              </label>
              <div>
                <ConfirmButton message="이 기록을 무효로 해 달라고 요청할까요?">무효 요청 보내기</ConfirmButton>
              </div>
            </form>
          </details>
        </section>
      )}

      {!selected && addDate && (
        <section id="form" className="card">
          <h2>{addDate} 기록 추가 요청</h2>
          <p className="small muted">이 날 태그를 아예 못 찍었다면, 실제 출근·퇴근 시간을 적어 요청하세요.</p>
          <form action={requestCorrection} className="item-fields">
            <input type="hidden" name="type" value="add" />
            <label>
              출근
              <input type="datetime-local" name="clock_in" required defaultValue={`${addDate}T11:00`} />
            </label>
            <label>
              퇴근
              <input type="datetime-local" name="clock_out" required defaultValue={`${addDate}T21:00`} />
            </label>
            {isPartTime && (
              <label>
                휴게시간
                <BreakSelect />
              </label>
            )}
            <label>
              사유
              <input name="reason" required placeholder="예: 휴대폰을 두고 와서 태그를 못 찍음" />
            </label>
            <div>
              <ConfirmButton message="이 내용으로 기록 추가를 요청할까요?">요청 보내기</ConfirmButton>
            </div>
          </form>
        </section>
      )}

      <h2>내 요청 내역</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>요청일</th>
              <th>종류</th>
              <th>요청 내용</th>
              <th>사유</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((q) => (
              <tr key={q.id}>
                <td>{q.created_at.slice(0, 10)}</td>
                <td>{REQUEST_TYPE_LABEL[q.request_type]}</td>
                <td>{formatProposal(q)}</td>
                <td>{q.reason}</td>
                <td>
                  <span
                    className={
                      q.status === 'pending'
                        ? 'badge badge-warn'
                        : q.status === 'approved'
                          ? 'badge badge-ok'
                          : q.status === 'rejected'
                            ? 'badge badge-danger'
                            : 'badge'
                    }
                    style={{ marginLeft: 0 }}
                  >
                    {REQUEST_STATUS_LABEL[q.status]}
                  </span>
                  {q.review_note && <div className="small muted">{q.review_note}</div>}
                </td>
                <td>
                  {q.status === 'pending' && (
                    <form action={cancelCorrection}>
                      <input type="hidden" name="id" value={q.id} />
                      <ConfirmButton message="이 요청을 취소할까요?">취소</ConfirmButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6}>요청 내역이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
