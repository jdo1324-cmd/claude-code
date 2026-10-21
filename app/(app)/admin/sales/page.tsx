import Link from 'next/link'
import { isMonth, monthRange } from '@/lib/attendance'
import { requireOwner, type Profile } from '@/lib/auth'
import { todayKST } from '@/lib/format'
import { SALES_SELECT, formatWon, paymentDiff, type SalesReport } from '@/lib/sales'
import { createClient } from '@/lib/supabase/server'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

export default async function MonthlySalesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams
  await requireOwner()
  const today = todayKST()
  const month = isMonth(monthParam) ? monthParam : today.slice(0, 7)
  const { start, end } = monthRange(month)
  const supabase = await createClient()

  const [{ data: reportData, error }, { data: profileData }] = await Promise.all([
    supabase
      .from('sales_reports')
      .select(SALES_SELECT)
      .eq('status', 'valid') // 무효(다시 작성 전) 보고서는 합계에서 제외
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date'),
    supabase.from('profiles').select('id, full_name'),
  ])
  const reports = (reportData ?? []) as unknown as SalesReport[]
  const names = Object.fromEntries(((profileData ?? []) as Pick<Profile, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name]))
  const byDate = new Map(reports.map((r) => [r.work_date, r]))

  // 그 달의 날짜 (이번 달이면 오늘까지)
  const lastDay = Number((month === today.slice(0, 7) ? today : end).slice(8, 10))
  const days = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)

  const sum = (key: keyof Pick<SalesReport, 'total_sales' | 'card_amount' | 'cash_amount' | 'other_amount' | 'cash_expense' | 'check_card_expense'>) =>
    reports.reduce((s, r) => s + Number(r[key]), 0)
  const totals = {
    total_sales: sum('total_sales'),
    card_amount: sum('card_amount'),
    cash_amount: sum('cash_amount'),
    other_amount: sum('other_amount'),
    cash_expense: sum('cash_expense'),
    check_card_expense: sum('check_card_expense'),
  }
  const totalDiff = paymentDiff(totals)
  const mismatchDays = reports.filter((r) => paymentDiff(r) !== 0).length
  const missingDays = days.filter((d) => !byDate.has(d)).length

  return (
    <main>
      <h1>월 매출 (사장 전용)</h1>
      <form method="get">
        <input type="month" name="month" defaultValue={month} /> <button type="submit">보기</button>
      </form>
      {error && <p style={{ color: 'crimson' }}>불러오지 못했습니다: {error.message}</p>}

      <section style={{ border: '2px solid #333', padding: 12, margin: '12px 0' }}>
        <h2 style={{ marginTop: 0 }}>{month} 합계</h2>
        <p style={{ fontSize: 22, margin: 0 }}>
          총 매출 <strong>{formatWon(totals.total_sales)}</strong> ({reports.length}일 보고)
        </p>
        <p>
          카드 {formatWon(totals.card_amount)} · 현금 {formatWon(totals.cash_amount)} · 기타{' '}
          {formatWon(totals.other_amount)}
        </p>
        <p>
          지출: 현금 {formatWon(totals.cash_expense)} · 체크카드 {formatWon(totals.check_card_expense)} · 합계{' '}
          {formatWon(totals.cash_expense + totals.check_card_expense)}
        </p>
        <p>
          일 평균 매출 {formatWon(reports.length ? Math.round(totals.total_sales / reports.length) : 0)}
        </p>
        {(mismatchDays > 0 || missingDays > 0) && (
          <p style={{ color: 'crimson' }}>
            {mismatchDays > 0 && `⚠️ 결제수단 합계와 매출이 다른 날 ${mismatchDays}일 (차이 합계 ${formatWon(totalDiff)}) `}
            {missingDays > 0 && `· 보고서 미제출 ${missingDays}일 (휴무일 포함)`}
          </p>
        )}
      </section>

      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>날짜</th>
            <th>매출</th>
            <th>카드</th>
            <th>현금</th>
            <th>기타</th>
            <th>차이</th>
            <th>현금 지출</th>
            <th>체크카드 지출</th>
            <th>작성자</th>
            <th>메모</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const r = byDate.get(d)
            const weekday = WEEKDAY[new Date(`${d}T12:00:00+09:00`).getUTCDay()]
            const label = (
              <Link href={`/admin/checklists?date=${d}`}>
                {d.slice(5)} ({weekday})
              </Link>
            )
            if (!r) {
              return (
                <tr key={d} style={{ color: '#999' }}>
                  <td>{label}</td>
                  <td colSpan={9}>미제출</td>
                </tr>
              )
            }
            const diff = paymentDiff(r)
            return (
              <tr key={d}>
                <td>{label}</td>
                <td style={{ textAlign: 'right' }}>{formatWon(r.total_sales)}</td>
                <td style={{ textAlign: 'right' }}>{formatWon(r.card_amount)}</td>
                <td style={{ textAlign: 'right' }}>{formatWon(r.cash_amount)}</td>
                <td style={{ textAlign: 'right' }}>{formatWon(r.other_amount)}</td>
                <td style={{ textAlign: 'right', color: diff ? 'crimson' : undefined, fontWeight: diff ? 'bold' : undefined }}>
                  {diff ? formatWon(diff) : '-'}
                </td>
                <td style={{ textAlign: 'right' }}>{formatWon(r.cash_expense)}</td>
                <td style={{ textAlign: 'right' }}>{formatWon(r.check_card_expense)}</td>
                <td>{names[r.submitted_by] ?? '?'}</td>
                <td>{r.note}</td>
              </tr>
            )
          })}
          <tr style={{ fontWeight: 'bold' }}>
            <td>합계</td>
            <td style={{ textAlign: 'right' }}>{formatWon(totals.total_sales)}</td>
            <td style={{ textAlign: 'right' }}>{formatWon(totals.card_amount)}</td>
            <td style={{ textAlign: 'right' }}>{formatWon(totals.cash_amount)}</td>
            <td style={{ textAlign: 'right' }}>{formatWon(totals.other_amount)}</td>
            <td style={{ textAlign: 'right' }}>{totalDiff ? formatWon(totalDiff) : '-'}</td>
            <td style={{ textAlign: 'right' }}>{formatWon(totals.cash_expense)}</td>
            <td style={{ textAlign: 'right' }}>{formatWon(totals.check_card_expense)}</td>
            <td colSpan={2}></td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 13 }}>
        날짜를 누르면 그날의 체크리스트와 보고서(다시 작성된 이전 보고서 포함)를 볼 수 있습니다. 차이 = 결제수단 합계 −
        매출.
      </p>
    </main>
  )
}
