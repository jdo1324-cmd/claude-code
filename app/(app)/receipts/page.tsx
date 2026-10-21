import { getCurrentProfile } from '@/lib/auth'
import { todayKST } from '@/lib/format'
import { ReceiptUpload } from './receipt-upload'

// AI 읽기가 응답 뒤 백그라운드로 돌기 때문에 넉넉히
export const maxDuration = 300

export default async function ReceiptsPage() {
  await getCurrentProfile()
  return (
    <main>
      <h1>거래처 전표 올리기</h1>
      <p>
        거래처에서 받은 전표(거래명세표·영수증)를 찍어서 올려 주세요. AI가 품목·수량·단가·금액을 읽고, 사장님·관리자가
        사진과 대조해서 확정합니다.
      </p>
      <p className="small muted">올린 사진과 품목 내용은 사장님·관리자만 볼 수 있습니다.</p>
      <ReceiptUpload date={todayKST()} />
    </main>
  )
}
