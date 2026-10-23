import { notFound } from 'next/navigation'
import { getCurrentProfile, isAdmin } from '@/lib/auth'
import { ReceiptDetail } from '../receipt-detail'

// [다시 읽기] 후 AI 읽기가 백그라운드로 돌기 때문에 넉넉히
export const maxDuration = 300

// 직원이 자기가 올린 전표를 확인·확정하는 화면 (다른 사람 전표는 DB에서 안 보임 → 404)
export default async function MyReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const [{ id: idParam }, { error, ok }] = await Promise.all([params, searchParams])
  const me = await getCurrentProfile()
  const id = Number(idParam)
  if (!Number.isInteger(id)) notFound()
  return <ReceiptDetail id={id} admin={isAdmin(me.role)} back="/receipts" error={error} ok={ok} />
}
