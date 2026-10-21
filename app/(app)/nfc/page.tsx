import Link from 'next/link'
import { AlertOnLoad } from '@/app/components/alert-on-load'
import { BreakForm } from '@/app/components/break-form'
import { ATTENDANCE_SELECT, validBreak, type AttendanceRecord } from '@/lib/attendance'
import { getCurrentProfile } from '@/lib/auth'
import { formatTime, todayKST } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { clockNfc } from '../actions'
import { ClockButton } from '../clock-button'

const NEED_BREAK_MESSAGE =
  '휴게시간을 입력하지 않아 퇴근 처리가 되지 않았습니다.\n휴게시간을 먼저 입력한 뒤 다시 [퇴근]을 눌러 주세요.'

// 21:30(한국 시간)이 지난 근무 중 기록은 곧 자동 퇴근 처리될 기록 (DB의 run_auto_clock_out 과 같은 기준)
function isPastAutoClockOut(workDate: string) {
  return Date.now() >= new Date(`${workDate}T21:30:00+09:00`).getTime()
}

// 매장 NFC 태그에 들어 있는 주소: /nfc?t=매장코드
// 링크 미리보기 등으로 실수로 기록되지 않도록, 태그를 찍으면 버튼 화면이 먼저 뜸.
export default async function NfcPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; need_break?: string; error?: string; ok?: string }>
}) {
  const { t = '', need_break, error, ok } = await searchParams
  const me = await getCurrentProfile()
  const supabase = await createClient()
  const today = todayKST()
  const back = `/nfc?t=${encodeURIComponent(t)}`

  const { data } = await supabase
    .from('attendance')
    .select(ATTENDANCE_SELECT)
    .eq('user_id', me.id)
    .eq('status', 'valid')
    .or(`clock_out.is.null,work_date.eq.${today}`)
  const records = (data ?? []) as unknown as AttendanceRecord[]

  const openRow = records.find((r) => r.clock_out === null)
  const working = openRow && !isPastAutoClockOut(openRow.work_date) ? openRow : null
  const todayRecord = records.find((r) => r.work_date === today)
  const isPartTime = me.employment_type === 'part_time'
  const breakMissing = !!working && isPartTime && validBreak(working) === null

  let body: React.ReactNode
  if (working) {
    body = (
      <>
        <span className="status-dot on">근무 중</span>
        <div className="hero-time">{formatTime(working.clock_in)}</div>
        <p className="muted" style={{ margin: 0 }}>
          출근 시간
        </p>
        {breakMissing ? (
          <>
            {/* 휴게시간 없이 퇴근하려는 아르바이트: 팝업 + 입력 칸, 퇴근 버튼은 입력 후에 보임 */}
            <AlertOnLoad message={NEED_BREAK_MESSAGE} />
            <p className="alert alert-error" style={{ textAlign: 'left' }}>
              휴게시간을 입력해야 퇴근할 수 있습니다. 아래에서 휴게시간을 입력한 뒤 [퇴근]을 눌러 주세요.
            </p>
            <div style={{ textAlign: 'left' }}>
              <BreakForm attendanceId={working.id} back={back} />
            </div>
          </>
        ) : (
          <>
            {isPartTime && <p className="small muted">휴게시간 {(validBreak(working) ?? 0) / 60}시간 · 입력 완료</p>}
            <form action={clockNfc}>
              <input type="hidden" name="t" value={t} />
              <input type="hidden" name="action" value="out" />
              <ClockButton working />
            </form>
          </>
        )}
      </>
    )
  } else if (todayRecord) {
    body = (
      <>
        <span className="status-dot">오늘 근무 끝</span>
        <div className="hero-time">
          {formatTime(todayRecord.clock_in)} – {formatTime(todayRecord.clock_out)}
        </div>
        <p className="muted">
          {todayRecord.auto_clock_out
            ? '21:30까지 퇴근을 찍지 않아 21:00로 자동 퇴근 처리되었습니다.'
            : '오늘 출퇴근이 끝났습니다. 수고하셨습니다!'}
        </p>
        <p className="small">
          시간이 잘못되었다면 <Link href={`/corrections?attendance_id=${todayRecord.id}`}>정정 요청</Link>을 해 주세요.
        </p>
      </>
    )
  } else {
    body = (
      <>
        <span className="status-dot">근무 전</span>
        <div className="hero-time">{formatTime(new Date().toISOString())}</div>
        <p className="muted" style={{ margin: 0 }}>
          지금 시각
        </p>
        {openRow && <p className="small muted">지난 근무는 21:00로 자동 퇴근 처리됩니다.</p>}
        <form action={clockNfc}>
          <input type="hidden" name="t" value={t} />
          <input type="hidden" name="action" value="in" />
          <ClockButton working={false} />
        </form>
      </>
    )
  }

  return (
    <main style={{ maxWidth: 520 }}>
      <h1>
        {me.full_name}님{' '}
        <span className="muted" style={{ fontWeight: 500 }}>
          출퇴근
        </span>
      </h1>
      {need_break && !breakMissing && <AlertOnLoad message={NEED_BREAK_MESSAGE} />}
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}
      <section className="clock-hero">{body}</section>
    </main>
  )
}
