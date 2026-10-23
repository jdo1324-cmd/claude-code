import { notFound } from 'next/navigation'
import { ReceiptDetail } from '@/app/(app)/receipts/receipt-detail'
import { requireAdmin } from '@/lib/auth'

// [다시 읽기] 후 AI 읽기가 백그라운드로 돌기 때문에 넉넉히
export const maxDuration = 300

export default async function AdminReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const [{ id: idParam }, { error, ok }] = await Promise.all([params, searchParams])
  await requireAdmin()
  const id = Number(idParam)
  if (!Number.isInteger(id)) notFound()
  return <ReceiptDetail id={id} admin back="/admin/receipts" error={error} ok={ok} />
}
