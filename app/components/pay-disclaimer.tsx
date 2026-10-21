import { PAY_DISCLAIMER } from '@/lib/pay'

// 급여 금액이 나오는 모든 화면에 표시
export function PayDisclaimer() {
  return (
    <p style={{ background: '#fff4d6', border: '2px solid #c90', padding: 10, fontWeight: 'bold' }}>
      ⚠️ {PAY_DISCLAIMER}
    </p>
  )
}
