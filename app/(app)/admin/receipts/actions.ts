'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { readReceipt } from '@/lib/receipt-ai'
import { createClient } from '@/lib/supabase/server'

function back(id: number, key: 'ok' | 'error', message: string): never {
  revalidatePath('/admin/receipts')
  revalidatePath(`/admin/receipts/${id}`)
  redirect(`/admin/receipts/${id}?${key}=${encodeURIComponent(message)}`)
}

// 사진과 대조한 값으로 확정 → 실제 기록(receipt_items)으로 반영
export async function confirmReceipt(formData: FormData) {
  await requireAdmin()
  const id = Number(formData.get('id'))
  let items: unknown
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]'))
  } catch {
    back(id, 'error', '품목 정보를 읽지 못했습니다.')
  }
  const rawTotal = String(formData.get('total_amount') ?? '').replace(/[,\s원]/g, '')

  const supabase = await createClient()
  const { error } = await supabase.rpc('confirm_receipt', {
    p_id: id,
    p_vendor: String(formData.get('vendor') ?? ''),
    p_receipt_date: String(formData.get('receipt_date') ?? '') || null,
    p_total: rawTotal === '' ? null : Number(rawTotal),
    p_items: items,
  })
  if (error) back(id, 'error', error.message)
  back(id, 'ok', '확정했습니다. 실제 기록으로 반영되었습니다.')
}

export async function closeReceipt(formData: FormData) {
  await requireAdmin()
  const id = Number(formData.get('id'))
  const status = formData.get('status') === 'void' ? 'void' : 'rejected'
  const supabase = await createClient()
  const { error } = await supabase.rpc('close_receipt', {
    p_id: id,
    p_status: status,
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back(id, 'error', error.message)
  back(id, 'ok', status === 'void' ? '무효 처리했습니다. 단가 비교에서 빠집니다.' : '반려했습니다.')
}

export async function retryReceipt(formData: FormData) {
  await requireAdmin()
  const id = Number(formData.get('id'))
  const supabase = await createClient()
  const { error } = await supabase.rpc('retry_receipt', { p_id: id })
  if (error) back(id, 'error', error.message)
  after(() => readReceipt(id))
  back(id, 'ok', 'AI가 다시 읽는 중입니다. 잠시 후 자동으로 바뀝니다.')
}
