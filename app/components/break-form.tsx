import { submitBreak } from '@/app/(app)/actions'
import { BREAK_OPTIONS, breakLabel } from '@/lib/attendance'
import { ConfirmButton } from './confirm-button'

export const BREAK_NOTICE =
  '휴게시간은 한 번 입력하면 직접 수정할 수 없습니다. 잘못 입력했다면 사장님이나 관리자에게 수정을 요청하세요.'

// 아르바이트 직원의 휴게시간 입력 칸
export function BreakForm({ attendanceId, back }: { attendanceId: number; back: string }) {
  return (
    <form action={submitBreak} style={{ border: '2px solid #c60', padding: 12, margin: '12px 0' }}>
      <input type="hidden" name="attendance_id" value={attendanceId} />
      <input type="hidden" name="back" value={back} />
      <p>
        <strong>오늘 휴게시간을 입력하세요.</strong> (0.5시간 단위)
      </p>
      <select name="minutes" required defaultValue="">
        <option value="" disabled>
          선택
        </option>
        {BREAK_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {breakLabel(m)}
          </option>
        ))}
      </select>{' '}
      <ConfirmButton message={`휴게시간을 {value}(으)로 저장합니다.\n\n${BREAK_NOTICE}\n\n저장할까요?`}>
        저장
      </ConfirmButton>
      <p style={{ color: '#c60', fontSize: 14 }}>⚠️ {BREAK_NOTICE}</p>
    </form>
  )
}
