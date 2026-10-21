import Link from 'next/link'
import { ConfirmButton } from '@/app/components/confirm-button'
import {
  ATTENDANCE_SELECT,
  BREAK_OPTIONS,
  breakLabel,
  validBreak,
  type AttendanceRecord,
} from '@/lib/attendance'
import { getCurrentProfile } from '@/lib/auth'
import { CORRECTION_SELECT, REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, type CorrectionRequest } from '@/lib/corrections'
import { formatTime, toKstInput, todayKST } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { cancelCorrection, requestCorrection } from './actions'

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

export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ attendance_id?: string; error?: string; ok?: string }>
}) {
  const { attendance_id, error, ok } = await searchParams
  const me = await getCurrentProfile()
  const isPartTime = me.employment_type === 'part_time'
  const supabase = await createClient()

  const [{ data: recordData }, { data: requestData }] = await Promise.all([
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('user_id', me.id)
      .eq('status', 'valid')
      .order('clock_in', { ascending: false })
      .limit(31),
    supabase
      .from('correction_requests')
      .select(CORRECTION_SELECT)
      .eq('user_id', me.id)
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  const records = (recordData ?? []) as unknown as AttendanceRecord[]
  const requests = (requestData ?? []) as unknown as CorrectionRequest[]
  const selected = records.find((r) => String(r.id) === attendance_id)

  return (
    <main>
      <h1>정정 요청</h1>
      <p>
        출퇴근 기록은 직접 고칠 수 없습니다. 정정 요청을 보내면 사장님이나 관리자가 확인 후 승인합니다. 승인되면
        원래 기록은 &quot;무효&quot;로 남고 새 기록이 추가됩니다.
      </p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {ok && <p style={{ color: 'green' }}>{ok}</p>}

      {selected ? (
        <section style={{ border: '1px solid #999', padding: 12 }}>
          <h2>
            {selected.work_date} 기록 정정 (현재: 출근 {formatTime(selected.clock_in)} · 퇴근{' '}
            {formatTime(selected.clock_out)}
            {isPartTime && ` · 휴게 ${validBreak(selected) === null ? '미입력' : breakLabel(validBreak(selected)!)}`})
          </h2>

          <h3>시간 수정 요청</h3>
          <form action={requestCorrection}>
            <input type="hidden" name="type" value="modify" />
            <input type="hidden" name="attendance_id" value={selected.id} />
            <p>
              출근{' '}
              <input type="datetime-local" name="clock_in" required defaultValue={toKstInput(selected.clock_in)} />{' '}
              퇴근 <input type="datetime-local" name="clock_out" defaultValue={toKstInput(selected.clock_out)} />
            </p>
            {isPartTime && (
              <p>
                휴게시간 <BreakSelect />
              </p>
            )}
            <p>
              사유 <input name="reason" required size={40} placeholder="예: 퇴근 태그를 깜빡함, 실제 퇴근 21:40" />
            </p>
            <ConfirmButton message="이 내용으로 정정 요청을 보낼까요?">요청 보내기</ConfirmButton>
          </form>

          <h3>기록 무효 요청 (그날 실제로 근무하지 않은 경우)</h3>
          <form action={requestCorrection}>
            <input type="hidden" name="type" value="void" />
            <input type="hidden" name="attendance_id" value={selected.id} />
            사유 <input name="reason" required size={40} placeholder="예: 쉬는 날인데 태그를 잘못 찍음" />{' '}
            <ConfirmButton message="이 기록을 무효로 해 달라고 요청할까요?">요청 보내기</ConfirmButton>
          </form>
          <p>
            <Link href="/corrections">다른 기록 선택</Link>
          </p>
        </section>
      ) : (
        <section>
          <h2>정정할 기록 선택</h2>
          <ul>
            {records.map((r) => (
              <li key={r.id}>
                {r.work_date} 출근 {formatTime(r.clock_in)} · 퇴근 {formatTime(r.clock_out)}
                {r.auto_clock_out && ' (자동 퇴근 처리)'} —{' '}
                <Link href={`/corrections?attendance_id=${r.id}`}>이 기록 정정</Link>
              </li>
            ))}
            {records.length === 0 && <li>기록이 없습니다.</li>}
          </ul>

          <h2>기록 추가 요청 (태그를 아예 못 찍은 날)</h2>
          <form action={requestCorrection}>
            <input type="hidden" name="type" value="add" />
            <p>
              출근 <input type="datetime-local" name="clock_in" required defaultValue={`${todayKST()}T11:00`} /> 퇴근{' '}
              <input type="datetime-local" name="clock_out" required />
            </p>
            {isPartTime && (
              <p>
                휴게시간 <BreakSelect />
              </p>
            )}
            <p>
              사유 <input name="reason" required size={40} placeholder="예: 휴대폰을 두고 와서 태그를 못 찍음" />
            </p>
            <ConfirmButton message="이 내용으로 기록 추가를 요청할까요?">요청 보내기</ConfirmButton>
          </form>
        </section>
      )}

      <h2>내 요청 내역</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
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
                {REQUEST_STATUS_LABEL[q.status]}
                {q.review_note && ` (${q.review_note})`}
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
    </main>
  )
}
