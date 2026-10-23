import type { ReceiptProposal } from '@/lib/receipt-ai'

export type Receipt = {
  id: number
  label: string | null
  photo_paths: string[]
  note: string | null
  created_by: string
  created_at: string
  status: 'processing' | 'proposed' | 'failed' | 'confirmed' | 'rejected' | 'void'
  proposal: ReceiptProposal | null
  ai_model: string | null
  ai_error: string | null
  vendor: string | null
  receipt_date: string | null
  total_amount: number | null
  confirmed_by: string | null
  confirmed_at: string | null
  closed_by: string | null
  closed_at: string | null
  close_reason: string | null
}

export type PriceRow = {
  id: number
  receipt_id: number
  vendor: string
  receipt_date: string
  item_name: string
  normalized_name: string
  unit: string | null
  quantity: number
  unit_price: number
  line_total: number
  prev_unit_price: number | null
  prev_receipt_date: string | null
  prev_vendor: string | null
}

export const RECEIPT_STATUS_LABEL = {
  processing: 'AI 읽는 중',
  proposed: '확인 대기 (AI 제안)',
  failed: '확인 대기 (AI 실패 · 직접 입력)',
  confirmed: '확정',
  rejected: '반려',
  void: '무효',
} as const

// 화면에 보이는 전표 이름: "#10월23일_1" (올린 날 + 그날 몇 번째). 이름이 없는 옛 전표는 번호로
export function receiptName(r: { id: number; label?: string | null }) {
  return `#${r.label ?? r.id}`
}

export function won(n: number | null | undefined) {
  return n == null ? '-' : `${Math.round(Number(n)).toLocaleString('ko-KR')}원`
}

// 단가 변동 표시: ▲ 3,000원 → 3,500원 (+16.7%)
export function priceChange(row: Pick<PriceRow, 'unit_price' | 'prev_unit_price'>) {
  if (row.prev_unit_price == null) return null
  const prev = Number(row.prev_unit_price)
  const now = Number(row.unit_price)
  if (prev === now) return { direction: 'same' as const, text: '변동 없음' }
  const pct = prev > 0 ? ((now - prev) / prev) * 100 : 0
  return {
    direction: now > prev ? ('up' as const) : ('down' as const),
    text: `${now > prev ? '▲' : '▼'} ${won(prev)} → ${won(now)} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`,
  }
}
