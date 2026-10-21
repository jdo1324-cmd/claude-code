'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { submitSalesReport } from './actions'

const toNumber = (s: string) => {
  const n = Number(s.replace(/[,\s원]/g, ''))
  return s.trim() === '' || Number.isNaN(n) ? 0 : n
}
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function SaveButton({ disabled, mismatch, diff }: { disabled: boolean; mismatch: boolean; diff: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      style={{ fontSize: 18, padding: '8px 24px' }}
      onClick={(e) => {
        if (
          mismatch &&
          !window.confirm(
            `⚠️ 결제수단 합계와 매출이 ${won(Math.abs(diff))} 다릅니다.\n\n그래도 저장할까요? (메모에 차이 사유를 적어 주세요)`,
          )
        ) {
          e.preventDefault()
        }
      }}
    >
      {pending ? '저장 중…' : '보고서 저장'}
    </button>
  )
}

export function SalesForm({
  blocked,
  replace,
  initialTotal,
}: {
  blocked: boolean
  replace: boolean
  initialTotal?: number | null
}) {
  const [v, setV] = useState({
    // 마감 체크리스트에 입력한 "포스 매출 마감 금액"으로 미리 채움 (고칠 수 있음)
    total_sales: initialTotal != null ? initialTotal.toLocaleString('ko-KR') : '',
    card_amount: '',
    cash_amount: '',
    other_amount: '',
    cash_expense: '',
    check_card_expense: '',
  })
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [key]: e.target.value })

  const total = toNumber(v.total_sales)
  const paymentSum = toNumber(v.card_amount) + toNumber(v.cash_amount) + toNumber(v.other_amount)
  const diff = paymentSum - total
  const filled = v.total_sales.trim() !== ''
  const mismatch = filled && diff !== 0

  const field = (key: keyof typeof v, label: string, required = true) => (
    <p>
      <label>
        {label}
        <br />
        <input
          name={key}
          value={v[key]}
          onChange={set(key)}
          inputMode="numeric"
          pattern="[0-9,]*"
          required={required}
          placeholder={required ? '0' : '없으면 비워 두세요'}
          disabled={blocked}
          size={16}
        />{' '}
        원
      </label>
    </p>
  )

  return (
    <form action={submitSalesReport} style={{ border: '1px solid #999', padding: 12 }}>
      <h3>매출</h3>
      {field('total_sales', '오늘 총 매출')}
      {initialTotal != null && (
        <p style={{ fontSize: 13, color: '#555' }}>
          마감 체크리스트의 &quot;포스 매출 마감 금액&quot;({won(initialTotal)})으로 미리 채웠습니다.
        </p>
      )}

      <h3>결제수단별 금액</h3>
      {field('card_amount', '카드')}
      {field('cash_amount', '현금')}
      {field('other_amount', '기타 (계좌이체, 상품권, 배달앱 등)')}
      <p>
        결제수단 합계: <strong>{won(paymentSum)}</strong>
      </p>
      {mismatch && (
        <p
          role="alert"
          style={{ background: '#fee', border: '2px solid crimson', color: 'crimson', padding: 8, fontWeight: 'bold' }}
        >
          ⚠️ 결제수단 합계({won(paymentSum)})와 매출({won(total)})이 {won(Math.abs(diff))}{' '}
          {diff > 0 ? '많습니다' : '부족합니다'}. 금액을 다시 확인하세요.
        </p>
      )}

      <h3>오늘 지출</h3>
      {field('cash_expense', '현금 지출', false)}
      {field('check_card_expense', '체크카드 지출', false)}

      <p>
        <label>
          메모 (지출 내용, 금액 차이 사유 등)
          <br />
          <textarea name="note" rows={3} cols={40} disabled={blocked} />
        </label>
      </p>
      {replace && (
        <p>
          <label>
            다시 작성하는 사유 (필수)
            <br />
            <input name="replace_reason" required size={40} disabled={blocked} placeholder="예: 카드 금액 오타" />
          </label>
        </p>
      )}
      <SaveButton disabled={blocked} mismatch={mismatch} diff={diff} />
    </form>
  )
}
