import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth'
import { formatTime, todayKST } from '@/lib/format'
import { RECEIPT_STATUS_LABEL, receiptName, won, type Receipt } from '@/lib/receipts'
import { createClient } from '@/lib/supabase/server'
import { ReceiptUpload } from './receipt-upload'

// AI 읽기가 응답 뒤 백그라운드로 돌기 때문에 넉넉히
export const maxDuration = 300

export default async function ReceiptsPage() {
  const me = await getCurrentProfile()
  const supabase = await createClient()
  const { data } = await supabase
    .from('receipts')
    .select('id, label, created_at, status, vendor, receipt_date, total_amount, proposal')
    .eq('created_by', me.id)
    .order('created_at', { ascending: false })
    .limit(20)
  const mine = (data ?? []) as Pick<
    Receipt,
    'id' | 'label' | 'created_at' | 'status' | 'vendor' | 'receipt_date' | 'total_amount' | 'proposal'
  >[]
  const todo = mine.filter((r) => ['processing', 'proposed', 'failed'].includes(r.status))

  return (
    <main>
      <h1>거래처 전표 올리기</h1>
      <p>
        거래처에서 받은 전표(거래명세표·영수증)를 찍어서 올려 주세요. AI가 품목·수량·단가·금액을 읽으면,{' '}
        <strong>올린 사람이 사진과 대조해서 확정</strong>합니다. 확정하면 매출 매입 장부에 적힙니다.
      </p>
      {todo.length > 0 && (
        <p className="alert alert-warn">
          확정 안 한 전표가 {todo.length}건 있습니다. 아래 &quot;내가 올린 전표&quot;에서 눌러 확인해 주세요.
        </p>
      )}
      <ReceiptUpload date={todayKST()} />

      <section>
        <h2>내가 올린 전표</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>번호</th>
                <th>올린 때</th>
                <th>상태</th>
                <th>거래처</th>
                <th className="num">합계</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/receipts/${r.id}`}>{receiptName(r)}</Link>
                  </td>
                  <td>
                    {r.created_at.slice(5, 10)} {formatTime(r.created_at)}
                  </td>
                  <td>
                    <Link href={`/receipts/${r.id}`}>{RECEIPT_STATUS_LABEL[r.status]}</Link>
                  </td>
                  <td>{r.vendor ?? r.proposal?.vendor ?? '-'}</td>
                  <td className="num">{won(r.total_amount ?? r.proposal?.total_amount)}</td>
                </tr>
              ))}
              {mine.length === 0 && (
                <tr>
                  <td colSpan={5}>아직 올린 전표가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
