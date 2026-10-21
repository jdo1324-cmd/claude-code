import { netMinutes, type AttendanceRecord } from '@/lib/attendance'

export type PayRate = {
  id: number
  user_id: string
  pay_type: 'hourly' | 'monthly'
  amount: number
  effective_from: string
  note: string | null
  status: 'valid' | 'void'
  void_reason: string | null
  created_at: string
}

export const PAY_RATE_SELECT = 'id, user_id, pay_type, amount, effective_from, note, status, void_reason, created_at'
export const PAY_TYPE_LABEL = { hourly: '시급', monthly: '월급' } as const

// 2026년 최저시급 (참고 경고용)
export const MINIMUM_WAGE_2026 = 10320

export const PAY_DISCLAIMER =
  '세전 잠정치입니다. 세금·4대보험을 빼지 않았고, 주휴·연장·야간·휴일 수당도 포함하지 않은 참고용 금액이며 실제 지급액이 아닙니다.'

export function won(n: number) {
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

// 그날 적용되는 급여 (적용일이 그날 이전인 유효 이력 중 가장 최근)
export function rateOn(rates: PayRate[], userId: string, date: string): PayRate | null {
  let found: PayRate | null = null
  for (const r of rates) {
    if (r.status !== 'valid' || r.user_id !== userId || r.effective_from > date) continue
    if (!found || r.effective_from > found.effective_from) found = r
  }
  return found
}

export type PayDay = { date: string; minutes: number; rate: PayRate; amount: number; cumulative: number }

export type MonthPay = {
  hourlyDays: PayDay[] // 시급제로 일한 날 (그날 시급 × 그날 실근무)
  hourlyTotal: number
  monthlyRate: PayRate | null // 그 달 기준일에 월급제면 그 달 월급
  total: number
  totalMinutes: number
  unpricedDays: number // 그날 적용할 급여가 등록되지 않은 근무일
}

// month: 'YYYY-MM', baseDate: 월급제 판단 기준일 (지난 달 = 말일, 이번 달 = 오늘)
export function computeMonthPay(
  userId: string,
  records: AttendanceRecord[],
  rates: PayRate[],
  baseDate: string,
): MonthPay {
  const days = records
    .filter((r) => r.user_id === userId && r.status === 'valid')
    .sort((a, b) => a.work_date.localeCompare(b.work_date))

  const hourlyDays: PayDay[] = []
  let cumulative = 0
  let totalMinutes = 0
  let unpricedDays = 0
  for (const r of days) {
    const minutes = netMinutes(r)
    if (minutes === null) continue // 근무 중
    totalMinutes += minutes
    const rate = rateOn(rates, userId, r.work_date)
    if (!rate) {
      unpricedDays++
      continue
    }
    if (rate.pay_type !== 'hourly') continue
    // 그날의 시급으로 계산 → 나중에 시급이 바뀌어도 이 날 금액은 그대로
    const amount = Math.round((minutes / 60) * rate.amount)
    cumulative += amount
    hourlyDays.push({ date: r.work_date, minutes, rate, amount, cumulative })
  }

  const base = rateOn(rates, userId, baseDate)
  const monthlyRate = base?.pay_type === 'monthly' ? base : null
  return {
    hourlyDays,
    hourlyTotal: cumulative,
    monthlyRate,
    total: cumulative + (monthlyRate?.amount ?? 0),
    totalMinutes,
    unpricedDays,
  }
}
