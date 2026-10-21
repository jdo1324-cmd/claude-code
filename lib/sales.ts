export type SalesReport = {
  id: number
  work_date: string
  total_sales: number
  card_amount: number
  cash_amount: number
  other_amount: number
  cash_expense: number
  check_card_expense: number
  note: string | null
  submitted_by: string
  submitted_at: string
  replaces_id: number | null
  status: 'valid' | 'void'
  void_reason: string | null
  voided_at: string | null
}

export const SALES_SELECT =
  'id, work_date, total_sales, card_amount, cash_amount, other_amount, cash_expense, check_card_expense, note, ' +
  'submitted_by, submitted_at, replaces_id, status, void_reason, voided_at'

export function formatWon(amount: number) {
  return `${Number(amount).toLocaleString('ko-KR')}원`
}

// 결제수단 합계 - 매출. 0이 아니면 경고
export function paymentDiff(r: Pick<SalesReport, 'total_sales' | 'card_amount' | 'cash_amount' | 'other_amount'>) {
  return Number(r.card_amount) + Number(r.cash_amount) + Number(r.other_amount) - Number(r.total_sales)
}
