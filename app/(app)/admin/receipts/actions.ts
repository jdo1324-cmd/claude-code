'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { sendReceiptToSheet } from '@/lib/google-sheet'
import { receiptName } from '@/lib/receipts'
import { createClient } from '@/lib/supabase/server'

// 전표 1건 화면의 동작은 app/(app)/receipts/receipt-actions.ts (올린 사람과 같이 씀)

// 확정됐지만 아직 장부에 안 적은 전표를 한꺼번에
export async function sendUnsentToSheet() {
  const me = await requireAdmin()
  const supabase = await createClient()
  const [{ data: confirmed }, { data: sent }] = await Promise.all([
    supabase.from('receipts').select('id, label').eq('status', 'confirmed').order('id'),
    supabase.from('receipt_sheet_exports').select('receipt_id'),
  ])
  const sentIds = new Set((sent ?? []).map((s) => s.receipt_id))
  const todo = ((confirmed ?? []) as { id: number; label: string | null }[]).filter((r) => !sentIds.has(r.id))
  const listBack = (key: 'ok' | 'error', message: string): never => {
    revalidatePath('/admin/receipts')
    redirect(`/admin/receipts?${key}=${encodeURIComponent(message)}`)
  }
  if (todo.length === 0) listBack('ok', '장부에 적을 전표가 없습니다. (확정된 전표는 모두 적었습니다)')

  let done = 0
  for (const r of todo) {
    const reply = await sendReceiptToSheet(r.id, me.id)
    if (!reply.ok)
      listBack('error', `${done}건 적은 뒤 전표 ${receiptName(r)}에서 멈췄습니다: ${reply.error ?? '알 수 없는 오류'}`)
    done++
  }
  listBack('ok', `전표 ${done}건을 매출 매입 장부에 적었습니다.`)
}
