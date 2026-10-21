import { PAY_DISCLAIMER } from '@/lib/pay'

// 급여 금액이 나오는 모든 화면에 표시
export function PayDisclaimer() {
  return <p className="alert alert-warn">⚠️ {PAY_DISCLAIMER}</p>
}
