import Link from 'next/link'
import { BreakForm } from '@/app/components/break-form'
import { PayDisclaimer } from '@/app/components/pay-disclaimer'
import { PAY_RATE_SELECT, computeMonthPay, won, type PayRate } from '@/lib/pay'
import {
  ATTENDANCE_SELECT,
  breakLabel,
  formatMinutes,
  monthRange,
  netMinutes,
  validBreak,
  type AttendanceRecord,
} from '@/lib/attendance'
import { getCurrentProfile } from '@/lib/auth'
import { formatTime, todayKST } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const me = await getCurrentProfile()
  const supabase = await createClient()
  const month = todayKST().slice(0, 7)
  const { start, end } = monthRange(month)
  const isPartTime = me.employment_type === 'part_time'

  const [{ data: recentData }, { data: monthData }, { data: rateData }] = await Promise.all([
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('user_id', me.id)
      .order('clock_in', { ascending: false })
      .limit(20),
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('user_id', me.id)
      .eq('status', 'valid')
      .gte('work_date', start)
      .lte('work_date', end),
    // 본인 급여 이력만 조회됨 (DB 권한)
    supabase.from('pay_rates').select(PAY_RATE_SELECT).eq('user_id', me.id),
  ])
  const rates = (rateData ?? []) as PayRate[]

  const records = (recentData ?? []) as unknown as AttendanceRecord[]
  const monthRecords = (monthData ?? []) as unknown as AttendanceRecord[]
  const monthTotal = monthRecords.reduce((sum, r) => sum + (netMinutes(r) ?? 0), 0)
  const myPay = rates.some((r) => r.status === 'valid')
    ? computeMonthPay(me.id, monthRecords, rates, todayKST())
    : null
  const open = records.find((r) => r.status === 'valid' && r.clock_out === null)
  // 아르바이트: 휴게시간을 아직 안 적은 유효 기록 (근무 중 또는 자동 퇴근된 기록)
  const missingBreak = isPartTime
    ? records.find((r) => r.status === 'valid' && validBreak(r) === null)
    : undefined

  return (
    <main>
      <h1>출퇴근</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {ok && <p style={{ color: 'green' }}>{ok}</p>}

      <p>
        <strong>{open ? `근무 중 (출근 ${formatTime(open.clock_in)})` : '현재 근무 중이 아닙니다.'}</strong>
      </p>
      <p>
        이번 달({month}) 근무시간: <strong>{formatMinutes(monthTotal)}</strong>
        {isPartTime && ' (휴게시간 제외)'}
      </p>
      {myPay && (
        <details>
          <summary>
            이번 달 세전 잠정 급여: <strong>{won(myPay.total)}</strong> (참고용)
          </summary>
          <PayDisclaimer />
          {myPay.monthlyRate && <p>월급 {won(myPay.monthlyRate.amount)}</p>}
          {myPay.hourlyDays.length > 0 && (
            <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>실근무</th>
                  <th>시급</th>
                  <th>그날 금액</th>
                  <th>누적</th>
                </tr>
              </thead>
              <tbody>
                {myPay.hourlyDays.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{formatMinutes(d.minutes)}</td>
                    <td>{won(d.rate.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{won(d.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{won(d.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      )}

      {missingBreak && <BreakForm attendanceId={missingBreak.id} back="/" />}

      <p>
        출근·퇴근은 <strong>매장 입구의 NFC 태그</strong>에 휴대폰을 갖다 대서 합니다. 하루에 한 번만 출근할 수
        있고, 출근 후 10분 안에는 퇴근이 되지 않습니다.
        {isPartTime && ' 아르바이트는 휴게시간을 입력해야 퇴근할 수 있습니다.'}
      </p>
      <p>21:30까지 퇴근 태그를 찍지 않으면 21:00 퇴근으로 &quot;자동 퇴근 처리&quot;됩니다.</p>
      <p>
        기록이 잘못되었거나 태그를 못 찍었다면 <Link href="/corrections">정정 요청</Link>을 해 주세요. 사장님이나
        관리자가 확인 후 승인합니다.
      </p>

      <h2>최근 내 기록</h2>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>날짜</th>
            <th>출근</th>
            <th>퇴근</th>
            {isPartTime && <th>휴게</th>}
            <th>근무시간</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const isVoid = r.status === 'void'
            const net = netMinutes(r)
            const brk = validBreak(r)
            return (
              <tr key={r.id} style={isVoid ? { color: '#999', textDecoration: 'line-through' } : undefined}>
                <td>{r.work_date}</td>
                <td>{formatTime(r.clock_in)}</td>
                <td>
                  {formatTime(r.clock_out)}
                  {r.auto_clock_out && ' (자동 퇴근 처리)'}
                </td>
                {isPartTime && <td>{brk === null ? '미입력' : breakLabel(brk)}</td>}
                <td>{isVoid ? '-' : net === null ? '근무 중' : formatMinutes(net)}</td>
                <td style={{ textDecoration: 'none' }}>
                  {isVoid ? `무효 (${r.void_reason ?? ''})` : r.source === 'nfc' ? '정상' : '정정됨'}
                </td>
                <td>{!isVoid && <Link href={`/corrections?attendance_id=${r.id}`}>정정 요청</Link>}</td>
              </tr>
            )
          })}
          {records.length === 0 && (
            <tr>
              <td colSpan={7}>기록이 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ fontSize: 13 }}>
        기록은 지워지거나 고쳐지지 않습니다. 정정이 승인되면 원래 기록은 &quot;무효&quot;로 남고 새 기록이
        추가됩니다.
      </p>
    </main>
  )
}
