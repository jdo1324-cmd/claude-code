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

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
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
  const myPay = rates.some((r) => r.status === 'valid') ? computeMonthPay(me.id, monthRecords, rates, todayKST()) : null
  const open = records.find((r) => r.status === 'valid' && r.clock_out === null)
  // 아르바이트: 휴게시간을 아직 안 적은 유효 기록 (근무 중 또는 자동 퇴근된 기록)
  const missingBreak = isPartTime ? records.find((r) => r.status === 'valid' && validBreak(r) === null) : undefined

  return (
    <main>
      <h1>출퇴근</h1>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <div className="grid">
        <section className="card">
          <div className="stat-label">지금 상태</div>
          <div className="big-number" style={{ color: open ? 'var(--success)' : undefined }}>
            {open ? '근무 중' : '근무 전'}
          </div>
          <div className="small muted">{open ? `출근 ${formatTime(open.clock_in)}` : '매장 NFC 태그로 출근하세요'}</div>
        </section>
        <section className="card">
          <div className="stat-label">이번 달 근무시간</div>
          <div className="big-number">{formatMinutes(monthTotal)}</div>
          <div className="small muted">
            {month}
            {isPartTime && ' · 휴게시간 제외'}
          </div>
        </section>
        {myPay && (
          <section className="card">
            <div className="stat-label">이번 달 세전 잠정 급여</div>
            <div className="big-number">{won(myPay.total)}</div>
            <div className="small muted">참고용 · 아래에서 자세히</div>
          </section>
        )}
      </div>

      {missingBreak && <BreakForm attendanceId={missingBreak.id} back="/" />}

      {myPay && (
        <details className="card">
          <summary>이번 달 급여 자세히 보기 (참고용)</summary>
          <PayDisclaimer />
          {myPay.monthlyRate && <p>월급 {won(myPay.monthlyRate.amount)}</p>}
          {myPay.hourlyDays.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>실근무</th>
                    <th className="num">시급</th>
                    <th className="num">그날 금액</th>
                    <th className="num">누적</th>
                  </tr>
                </thead>
                <tbody>
                  {myPay.hourlyDays.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{formatMinutes(d.minutes)}</td>
                      <td className="num">{won(d.rate.amount)}</td>
                      <td className="num">{won(d.amount)}</td>
                      <td className="num">{won(d.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}

      <details className="card">
        <summary>출퇴근 규칙 보기</summary>
        <ul className="small" style={{ margin: '4px 0 0' }}>
          <li>
            출근·퇴근은 <strong>매장 입구의 NFC 태그</strong>에 휴대폰을 갖다 대서 합니다.
          </li>
          <li>하루에 한 번만 출근할 수 있고, 출근 후 10분 안에는 퇴근이 되지 않습니다.</li>
          {isPartTime && <li>아르바이트는 휴게시간을 입력해야 퇴근할 수 있습니다.</li>}
          <li>21:30까지 퇴근 태그를 찍지 않으면 21:00 퇴근으로 &quot;자동 퇴근 처리&quot;됩니다.</li>
          <li>
            기록이 잘못되었거나 태그를 못 찍었다면 <Link href="/corrections">정정 요청</Link>을 해 주세요. 사장님이나
            관리자가 확인 후 승인합니다.
          </li>
        </ul>
      </details>

      <h2>최근 내 기록</h2>
      <div className="table-wrap">
        <table>
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
                <tr key={r.id} className={isVoid ? 'void-row' : undefined}>
                  <td>{r.work_date}</td>
                  <td>{formatTime(r.clock_in)}</td>
                  <td>
                    {formatTime(r.clock_out)}
                    {r.auto_clock_out && ' (자동 퇴근 처리)'}
                  </td>
                  {isPartTime && <td>{brk === null ? '미입력' : breakLabel(brk)}</td>}
                  <td>{isVoid ? '-' : net === null ? '근무 중' : formatMinutes(net)}</td>
                  <td className="keep">
                    {isVoid ? (
                      <span className="badge" style={{ marginLeft: 0 }}>
                        무효 ({r.void_reason ?? ''})
                      </span>
                    ) : r.source === 'nfc' ? (
                      <span className="badge badge-ok" style={{ marginLeft: 0 }}>
                        정상
                      </span>
                    ) : (
                      <span className="badge badge-warn" style={{ marginLeft: 0 }}>
                        정정됨
                      </span>
                    )}
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
      </div>
      <p className="small muted">
        기록은 지워지거나 고쳐지지 않습니다. 정정이 승인되면 원래 기록은 &quot;무효&quot;로 남고 새 기록이 추가됩니다.
      </p>
    </main>
  )
}
