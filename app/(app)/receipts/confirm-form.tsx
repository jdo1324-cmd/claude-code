'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { ReceiptProposal } from '@/lib/receipt-ai'
import { confirmReceipt } from './receipt-actions'

// ai: AI가 읽은 몇 번째 줄인지 (직접 추가한 줄은 null) → 확정할 때 AI 값과 비교해 고친 곳을 기록
type Row = {
  name: string
  quantity: string
  unit: string
  unit_price: string
  line_total: string
  tax: string
  ledger: string
  ai: number | null
}
export type LedgerItem = { section: string; name: string }

// 장부 품목 값: "구역|품목" (구역이 달라도 이름이 같은 품목이 있어서)
const ledgerKey = (it: LedgerItem) => `${it.section}|${it.name}`
const core = (s: string) =>
  s
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s\d.,]+(kg|g|ml|l|개|박스)?/gi, '')
    .toLowerCase()

// 전표 품목명으로 장부 품목을 짐작: 장부 이름이 전표 이름(또는 그 낱말)과 같거나 그 안에 들어 있는 것 중 가장 긴 것.
// 같으면 거래처와 구역이 맞는 쪽 (예: 프레시원 전표의 짜사이 → 프레시원 짜사이)
// history: 예전에 같은 품목명으로 확정할 때 고른 장부 품목 (있으면 그것부터)
export function guessLedger(
  itemName: string,
  vendor: string,
  items: LedgerItem[],
  history: Record<string, string> = {},
) {
  const past = history[itemName.replace(/\s+/g, '').toLowerCase()]
  if (past && items.some((it) => ledgerKey(it) === past)) return past
  const name = core(itemName)
  const words = itemName
    .split(/[\s/]+/)
    .map(core)
    .filter(Boolean)
  if (!name) return ''
  const v = vendor.replace(/\s/g, '')
  let best: LedgerItem | null = null
  let bestScore = 0
  for (const it of items) {
    const c = core(it.name)
    if (!c || !(name === c || words.includes(c) || (c.length >= 2 && name.includes(c)))) continue
    const score =
      c.length * 10 + (name === c || words.includes(c) ? 5 : 0) + (v && v.includes(it.section.split(' ')[0]) ? 3 : 0)
    if (score > bestScore) {
      best = it
      bestScore = score
    }
  }
  return best ? ledgerKey(best) : ''
}

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
      className="btn-lg"
      onClick={(e) => {
        const msg =
          (warnings > 0 ? `⚠️ 확인할 곳이 ${warnings}군데 있습니다.\n\n` : '') +
          '사진과 대조해서 확인했나요? 확정하면 실제 기록으로 반영되고 수정할 수 없습니다 (틀리면 무효 처리).'
        if (!window.confirm(msg)) e.preventDefault()
      }}
    >
      {pending ? '확정 중…' : '확인 완료 · 확정'}
    </button>
  )
}

// AI 제안 값을 채워서 보여주고, 올린 사람(또는 관리자)이 사진과 대조해 고친 뒤 확정
export function ConfirmForm({
  id,
  proposal,
  ledgerItems,
  ledgerHistory,
  back,
}: {
  id: number
  proposal: ReceiptProposal | null
  ledgerItems: LedgerItem[]
  ledgerHistory: Record<string, string>
  back: string
}) {
  const [vendor, setVendor] = useState(proposal?.vendor ?? '')
  const [date, setDate] = useState(
    proposal?.receipt_date && /^\d{4}-\d{2}-\d{2}$/.test(proposal.receipt_date) ? proposal.receipt_date : '',
  )
  const [total, setTotal] = useState(str(proposal?.total_amount))
  const [rows, setRows] = useState<Row[]>(
    proposal?.items.length
      ? proposal.items.map((i, n) => ({
          ai: n,
          name: i.name,
          quantity: str(i.quantity),
          unit: i.unit ?? '',
          unit_price: str(i.unit_price),
          line_total: str(i.line_total),
          tax: str(i.tax),
          ledger: guessLedger(i.name, proposal.vendor ?? '', ledgerItems, ledgerHistory),
        }))
      : [{ name: '', quantity: '', unit: '', unit_price: '', line_total: '', tax: '', ledger: '', ai: null }],
  )

  const update = (i: number, key: keyof Row, value: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)))

  // 꼭 필요한 것: 품목명 · 수량 · 공급가. 단가는 (공급가 + 세액) ÷ 수량으로 계산해 기록 (전표의 단가 칸은 참고용, 선택)
  const amountOf = (r: Row) => (num(r.line_total) ?? 0) + (num(r.tax) ?? 0)
  const rowWarn = rows.map((r) => {
    const q = num(r.quantity),
      t = num(r.line_total)
    if (!r.name.trim()) return '품목명을 적어 주세요'
    if (q == null || q <= 0) return '수량을 적어 주세요'
    if (t == null) return '공급가를 적어 주세요'
    return null
  })
  // 전표의 단가 × 수량이 공급가(또는 공급가+세액)와 다르면 알려만 줌 (확정은 됨)
  const rowNote = rows.map((r) => {
    const q = num(r.quantity),
      p = num(r.unit_price),
      t = num(r.line_total)
    return q != null && p != null && t != null && Math.abs(q * p - t) > 1 && Math.abs(q * p - amountOf(r)) > 1
      ? `전표 단가×수량=${won(q * p)} (공급가와 다름)`
      : null
  })
  const sum = rows.reduce((s, r) => s + amountOf(r), 0)
  const totalNum = num(total)
  const totalWarn = totalNum != null && Math.abs(sum - totalNum) > 1
  const warnings = rowWarn.filter(Boolean).length + (totalWarn ? 1 : 0)
  const noLedger = rows.filter((r) => !r.ledger).length
  const sections = [...new Set(ledgerItems.map((it) => it.section))]

  const items = rows.map((r) => ({
    name: r.name.trim(),
    quantity: num(r.quantity),
    unit: r.unit.trim() || null,
    unit_price: num(r.unit_price),
    line_total: num(r.line_total),
    tax: num(r.tax),
    ledger_item: r.ledger || null,
    ai_line: r.ai,
  }))

  return (
    <form action={confirmReceipt} className="card">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <div className="receipt-line-nums receipt-head-fields">
        <label>
          거래처
          <input name="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} required />
        </label>
        <label>
          전표 날짜
          <input type="date" name="receipt_date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      {/* 품목마다 카드 한 장 (휴대폰에서도 옆으로 밀리지 않게) */}
      <div className="receipt-lines">
        {rows.map((r, i) => (
          <div key={i} className={rowWarn[i] ? 'receipt-line warn' : 'receipt-line'}>
            <div className="receipt-line-head">
              <label>
                품목명
                <input value={r.name} onChange={(e) => update(i, 'name', e.target.value)} />
              </label>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                disabled={rows.length === 1}
              >
                삭제
              </button>
            </div>
            <div className="receipt-line-nums">
              <label>
                수량
                <input value={r.quantity} onChange={(e) => update(i, 'quantity', e.target.value)} inputMode="decimal" />
              </label>
              <label>
                단위
                <input value={r.unit} onChange={(e) => update(i, 'unit', e.target.value)} />
              </label>
              <label>
                공급가(원)
                <input
                  value={r.line_total}
                  onChange={(e) => update(i, 'line_total', e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label>
                세액(원, 선택)
                <input value={r.tax} onChange={(e) => update(i, 'tax', e.target.value)} inputMode="numeric" />
              </label>
              <label>
                전표 단가(원, 선택)
                <input
                  value={r.unit_price}
                  onChange={(e) => update(i, 'unit_price', e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <div className="receipt-calc">
                <span>기록될 금액 · 단가</span>
                <strong>
                  {won(amountOf(r))}
                  {num(r.quantity) ? ` · ${won(amountOf(r) / num(r.quantity)!)}` : ''}
                </strong>
              </div>
            </div>
            <label>
              장부 품목
              <select
                value={r.ledger}
                onChange={(e) => update(i, 'ledger', e.target.value)}
                className={r.ledger ? undefined : 'select-warn'}
              >
                <option value="">— 장부에 안 적음 —</option>
                {sections.map((sec) => (
                  <optgroup key={sec} label={sec}>
                    {ledgerItems
                      .filter((it) => it.section === sec)
                      .map((it) => (
                        <option key={ledgerKey(it)} value={ledgerKey(it)}>
                          {it.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {rowWarn[i] && <span className="small text-danger">⚠️ {rowWarn[i]}</span>}
            {rowNote[i] && <span className="small text-warn">참고: {rowNote[i]}</span>}
          </div>
        ))}
      </div>
      <p>
        <button
          type="button"
          onClick={() =>
            setRows([
              ...rows,
              { name: '', quantity: '', unit: '', unit_price: '', line_total: '', tax: '', ledger: '', ai: null },
            ])
          }
        >
          + 품목 추가
        </button>
      </p>
      <p>
        품목 금액 합(공급가+세액): <strong>{won(sum)}</strong> · 전표 합계{' '}
        <input
          name="total_amount"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          size={10}
          inputMode="numeric"
        />{' '}
        원
        {totalWarn && (
          <strong className="text-danger">
            {' '}
            ⚠️ 품목 합과 {won(Math.abs(sum - (totalNum ?? 0)))} 차이 (세액 칸을 빠뜨렸는지 확인)
          </strong>
        )}
      </p>
      <p className="small muted">
        <strong>장부 품목</strong>: 확정하면 매출 매입 장부의 그 품목 · 전표 날짜 칸에 금액이 더해지고, 평균단가에도
        반영됩니다. 장부에 없는 품목은 &quot;장부에 안 적음&quot;으로 두세요.
        {noLedger > 0 && <strong style={{ color: 'var(--warn)' }}> (장부 품목을 안 고른 줄 {noLedger}개)</strong>}
      </p>
      <ConfirmButton warnings={warnings} />
    </form>
  )
}
