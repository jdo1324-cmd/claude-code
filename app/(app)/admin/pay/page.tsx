import { ConfirmButton } from '@/app/components/confirm-button'
import { PayDisclaimer } from '@/app/components/pay-disclaimer'
import { ATTENDANCE_SELECT, formatMinutes, isMonth, monthRange, type AttendanceRecord } from '@/lib/attendance'
import { requireOwner, type Profile } from '@/lib/auth'
import { EMPLOYMENT_LABEL, todayKST } from '@/lib/format'
import {
  MINIMUM_WAGE_2026,
  PAY_RATE_SELECT,
  PAY_TYPE_LABEL,
  computeMonthPay,
  rateOn,
  won,
  type PayRate,
} from '@/lib/pay'
import { createClient } from '@/lib/supabase/server'
import { addPayRate, voidPayRate } from './actions'

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; error?: string; ok?: string }>
}) {
  const { month: monthParam, error, ok } = await searchParams
  await requireOwner()
  const today = todayKST()
  const month = isMonth(monthParam) ? monthParam : today.slice(0, 7)
  const { start, end } = monthRange(month)
  const baseDate = month === today.slice(0, 7) ? today : end
  const supabase = await createClient()

  const [{ data: profileData }, { data: rateData }, { data: recordData }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('pay_rates').select(PAY_RATE_SELECT).order('effective_from', { ascending: false }),
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('status', 'valid')
      .gte('work_date', start)
      .lte('work_date', end),
  ])
  const employees = (profileData ?? []) as Profile[]
  const rates = (rateData ?? []) as PayRate[]
  const records = (recordData ?? []) as unknown as AttendanceRecord[]

  const rows = employees.map((e) => ({
    e,
    current: rateOn(rates, e.id, today),
    upcoming: rates.filter((r) => r.user_id === e.id && r.status === 'valid' && r.effective_from > today),
    pay: computeMonthPay(e.id, records, rates, baseDate),
  }))
  const grandTotal = rows.reduce((s, r) => s + r.pay.total, 0)

  return (
    <main>
      <h1>급여 (세전 잠정, 사장 전용)</h1>
      <PayDisclaimer />
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <form method="get">
        <input type="month" name="month" defaultValue={month} /> <button type="submit">보기</button>
      </form>

      <h2>{month} 세전 잠정 급여</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>고용 형태</th>
              <th>현재 급여</th>
              <th>실근무</th>
              <th>세전 잠정 금액</th>
              <th>확인 필요</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, current, pay }) => (
              <tr key={e.id} style={e.is_active ? undefined : { color: 'var(--faint)' }}>
                <td>{e.full_name}</td>
                <td>{EMPLOYMENT_LABEL[e.employment_type]}</td>
                <td>{current ? `${PAY_TYPE_LABEL[current.pay_type]} ${won(current.amount)}` : '미등록'}</td>
                <td>{formatMinutes(pay.totalMinutes)}</td>
                <td className="num">
                  <strong>{won(pay.total)}</strong>
                  {pay.monthlyRate && <div className="small muted">월급 {won(pay.monthlyRate.amount)}</div>}
                  {pay.hourlyDays.length > 0 && (
                    <div className="small muted">
                      시급 근무 {pay.hourlyDays.length}일 {won(pay.hourlyTotal)}
                    </div>
                  )}
                </td>
                <td style={{ color: 'var(--danger)', fontSize: 13 }}>
                  {pay.unpricedDays > 0 && `급여 미등록 근무 ${pay.unpricedDays}일(금액 제외)`}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan={4}>합계 (세전 잠정)</td>
              <td className="num">{won(grandTotal)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>시급제 날짜별 누적</h2>
      <p className="small muted">
        그날 실근무 시간(휴게 제외) × <strong>그날 적용된 시급</strong>. 나중에 시급이 바뀌어도 지난 날 금액은 바뀌지
        않습니다.
      </p>
      {rows
        .filter(({ pay }) => pay.hourlyDays.length > 0)
        .map(({ e, pay }) => (
          <details key={e.id} open>
            <summary>
              {e.full_name} — {won(pay.hourlyTotal)} ({pay.hourlyDays.length}일)
            </summary>
            <div className="table-wrap">
              <table style={{ margin: '4px 0 12px' }}>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>실근무</th>
                    <th>적용 시급</th>
                    <th>그날 금액</th>
                    <th>누적</th>
                  </tr>
                </thead>
                <tbody>
                  {pay.hourlyDays.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{formatMinutes(d.minutes)}</td>
                      <td>{won(d.rate.amount)}</td>
                      <td className="num">{won(d.amount)}</td>
                      <td className="num">{won(d.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      {rows.every(({ pay }) => pay.hourlyDays.length === 0) && <p>이 달 시급제 근무 기록이 없습니다.</p>}

      <h2>급여 정보 등록 (이력)</h2>
      <ul className="small muted">
        <li>&quot;몇 월 며칠부터 얼마&quot;로 쌓입니다. 시급이 오르면 새 적용일로 추가하세요.</li>
        <li>지난 근무 금액이 바뀌지 않도록, 처음 등록이 아니면 적용일은 오늘 이후만 가능합니다.</li>
        <li>
          무효 처리는 아직 적용 전이거나 오늘 등록한 이력만 가능합니다. 월급제는 그 달 기준일(이번 달은 오늘)에 적용
          중인 월급을 그대로 씁니다.
        </li>
      </ul>
      <form action={addPayRate} className="card">
        <select name="user_id" required defaultValue="">
          <option value="" disabled>
            직원 선택
          </option>
          {employees
            .filter((e) => e.is_active)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({EMPLOYMENT_LABEL[e.employment_type]})
              </option>
            ))}
        </select>{' '}
        <select name="pay_type" defaultValue="hourly">
          <option value="hourly">시급</option>
          <option value="monthly">월급</option>
        </select>{' '}
        금액 <input name="amount" inputMode="numeric" pattern="[0-9,]+" required size={10} /> 원 · 적용 시작일{' '}
        <input type="date" name="effective_from" required defaultValue={today} /> 메모{' '}
        <input name="note" size={12} placeholder="예: 3개월 후 인상" />{' '}
        <ConfirmButton message="이 급여 정보를 등록할까요? (등록 후에는 수정할 수 없고, 적용 전에만 무효 처리할 수 있습니다)">
          등록
        </ConfirmButton>
        <div className="small muted">참고: 2026년 최저시급 {won(MINIMUM_WAGE_2026)}</div>
      </form>

      {rows.map(({ e, current, upcoming }) => {
        const history = rates.filter((r) => r.user_id === e.id)
        if (history.length === 0) return null
        return (
          <section key={e.id} style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 4 }}>
              {e.full_name}
              {current?.pay_type === 'hourly' && current.amount < MINIMUM_WAGE_2026 && (
                <span style={{ color: 'var(--danger)', fontSize: 14 }}>
                  {' '}
                  ⚠️ 현재 시급이 2026년 최저시급보다 낮습니다
                </span>
              )}
              {upcoming.length > 0 && (
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>
                  {' '}
                  (예정: {upcoming.map((u) => `${u.effective_from}부터 ${won(u.amount)}`).join(', ')})
                </span>
              )}
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>적용 시작일</th>
                    <th>종류</th>
                    <th>금액</th>
                    <th>메모</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => {
                    const canVoid =
                      r.status === 'valid' && (r.effective_from >= today || isTodayKst(r.created_at, today))
                    return (
                      <tr key={r.id} className={r.status === 'void' ? 'void-row' : undefined}>
                        <td>{r.effective_from}</td>
                        <td>{PAY_TYPE_LABEL[r.pay_type]}</td>
                        <td className="num">{won(r.amount)}</td>
                        <td>{r.note}</td>
                        <td className="keep">
                          {r.status === 'void'
                            ? `무효 (${r.void_reason})`
                            : r.id === current?.id
                              ? '적용 중'
                              : r.effective_from > today
                                ? '예정'
                                : '지난 이력'}
                          {canVoid && (
                            <form action={voidPayRate} style={{ display: 'inline', marginLeft: 6 }}>
                              <input type="hidden" name="id" value={r.id} />
                              <input name="reason" required placeholder="사유" size={8} />{' '}
                              <ConfirmButton message="이 급여 이력을 무효 처리할까요? (이력에는 남습니다)">
                                무효
                              </ConfirmButton>
                            </form>
                          )}
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
    </main>
  )
}

function isTodayKst(iso: string, today: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso)) === today
}
