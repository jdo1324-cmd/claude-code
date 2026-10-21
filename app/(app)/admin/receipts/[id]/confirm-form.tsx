'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { ReceiptProposal } from '@/lib/receipt-ai'
import { confirmReceipt } from '../actions'

type Row = { name: string; quantity: string; unit: string; unit_price: string; line_total: string }

const str = (n: number | null | undefined) => (n == null ? '' : String(n))
const num = (s: string) => {
  const n = Number(s.replace(/[,\s원]/g, ''))
  return s.trim() === '' || Number.isNaN(n) ? null : n
}
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`

function ConfirmButton({ warnings }: { warnings: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ fontSize: 18, padding: '8px 24px' }}
      onClick={(e) => {
        const msg =
          (warnings > 0 ? `⚠️ 계산이 맞지 않는 곳이 ${warnings}군데 있습니다.\n\n` : '') +
          '사진과 대조해서 확인했나요? 확정하면 실제 기록으로 반영되고 수정할 수 없습니다 (틀리면 무효 처리).'
        if (!window.confirm(msg)) e.preventDefault()
      }}
    >
      {pending ? '확정 중…' : '확인 완료 · 확정'}
    </button>
  )
}

// AI 제안 값을 채워서 보여주고, 관리자가 사진과 대조해 고친 뒤 확정
export function ConfirmForm({ id, proposal }: { id: number; proposal: ReceiptProposal | null }) {
  const [vendor, setVendor] = useState(proposal?.vendor ?? '')
  const [date, setDate] = useState(proposal?.receipt_date && /^\d{4}-\d{2}-\d{2}$/.test(proposal.receipt_date) ? proposal.receipt_date : '')
  const [total, setTotal] = useState(str(proposal?.total_amount))
  const [rows, setRows] = useState<Row[]>(
    proposal?.items.length
      ? proposal.items.map((i) => ({
          name: i.name,
          quantity: str(i.quantity),
          unit: i.unit ?? '',
          unit_price: str(i.unit_price),
          line_total: str(i.line_total),
        }))
      : [{ name: '', quantity: '', unit: '', unit_price: '', line_total: '' }],
  )

  const update = (i: number, key: keyof Row, value: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)))

  // 계산 확인: 수량 × 단가 = 금액, 금액 합 = 합계
  const rowWarn = rows.map((r) => {
    const q = num(r.quantity), p = num(r.unit_price), t = num(r.line_total)
    if (!r.name.trim() || q == null || p == null || t == null) return '빈 칸'
    return Math.abs(q * p - t) > 1 ? `수량×단가=${won(q * p)}` : null
  })
  const sum = rows.reduce((s, r) => s + (num(r.line_total) ?? 0), 0)
  const totalNum = num(total)
  const totalWarn = totalNum != null && Math.abs(sum - totalNum) > 1
  const warnings = rowWarn.filter(Boolean).length + (totalWarn ? 1 : 0)

  const items = rows.map((r) => ({
    name: r.name.trim(),
    quantity: num(r.quantity),
    unit: r.unit.trim() || null,
    unit_price: num(r.unit_price),
    line_total: num(r.line_total),
  }))

  return (
    <form action={confirmReceipt} style={{ border: '2px solid #333', padding: 12 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <p>
        거래처 <input name="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} required size={16} />{' '}
        전표 날짜 <input type="date" name="receipt_date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </p>
      <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>품목명</th>
            <th>수량</th>
            <th>단위</th>
            <th>단가(원)</th>
            <th>금액(원)</th>
            <th>확인</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={rowWarn[i] ? { background: '#fee' } : undefined}>
              <td><input value={r.name} onChange={(e) => update(i, 'name', e.target.value)} size={14} /></td>
              <td><input value={r.quantity} onChange={(e) => update(i, 'quantity', e.target.value)} size={5} inputMode="decimal" /></td>
              <td><input value={r.unit} onChange={(e) => update(i, 'unit', e.target.value)} size={4} /></td>
              <td><input value={r.unit_price} onChange={(e) => update(i, 'unit_price', e.target.value)} size={8} inputMode="numeric" /></td>
              <td><input value={r.line_total} onChange={(e) => update(i, 'line_total', e.target.value)} size={9} inputMode="numeric" /></td>
              <td style={{ color: 'crimson', fontSize: 12 }}>{rowWarn[i] ?? '✔'}</td>
              <td>
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <button type="button" onClick={() => setRows([...rows, { name: '', quantity: '', unit: '', unit_price: '', line_total: '' }])}>
          + 품목 추가
        </button>
      </p>
      <p>
        품목 금액 합: <strong>{won(sum)}</strong> · 전표 합계{' '}
        <input name="total_amount" value={total} onChange={(e) => setTotal(e.target.value)} size={10} inputMode="numeric" /> 원
        {totalWarn && <strong style={{ color: 'crimson' }}> ⚠️ 품목 합과 {won(Math.abs(sum - (totalNum ?? 0)))} 차이 (부가세 별도 전표인지 확인)</strong>}
      </p>
      <ConfirmButton warnings={warnings} />
    </form>
  )
}
