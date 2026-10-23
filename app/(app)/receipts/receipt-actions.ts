'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { getCurrentProfile, requireAdmin } from '@/lib/auth'
import { getSheetSettings, sendReceiptToSheet, type ReceiptReply } from '@/lib/google-sheet'
import { readReceipt } from '@/lib/receipt-ai'
import { recordCorrections } from '@/lib/receipt-learning'
import { createClient } from '@/lib/supabase/server'

// 전표 화면 공용 동작. 사장/관리자 화면(/admin/receipts/…)과 올린 사람 화면(/receipts/…)에서 같이 씀.
// 누가 할 수 있는지는 DB 함수가 확인함 (확정·다시 읽기·반려: 올린 사람 또는 관리자, 무효·다시 보내기: 관리자).

function backPath(formData: FormData, id: number) {
  const back = String(formData.get('back') ?? '')
  return back === '/admin/receipts' || back === '/receipts' ? `${back}/${id}` : `/receipts/${id}`
}

function back(path: string, key: 'ok' | 'error', message: string): never {
  revalidatePath('/admin/receipts')
  revalidatePath('/receipts')
  revalidatePath(path)
  redirect(`${path}?${key}=${encodeURIComponent(message)}`)
}

// 장부에 쓴 결과를 사람이 읽을 문장으로
function ledgerMessage(reply: ReceiptReply) {
  if (!reply.ok) return `⚠️ 매출 매입 장부에는 적지 못했습니다: ${reply.error}`
  return [
    `매출 매입 장부 "${reply.tab}" 탭에 ${reply.written?.length ?? 0}개 품목을 적었습니다.`,
    reply.created && '(탭이 없어서 "XX년X월"을 복사해 만들었습니다)',
    reply.skipped?.length && `⚠️ 장부에 안 적은 품목: ${reply.skipped.join(', ')}`,
    reply.noPrice?.length && `평균단가에 반영 못 한 품목: ${reply.noPrice.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// 전표에 적힌 단가가 (공급가+세액)÷수량 과도, 공급가÷수량 과도 다르면 그 품목을 알려 줌
function unitPriceWarnings(items: unknown) {
  if (!Array.isArray(items)) return []
  return (
    items as {
      name: string
      quantity: number | null
      unit_price: number | null
      line_total: number | null
      tax?: number | null
    }[]
  )
    .filter((it) => {
      const q = Number(it.quantity),
        p = it.unit_price,
        t = it.line_total
      if (!(q > 0) || p == null || t == null) return false
      return Math.abs(p - (t + (it.tax ?? 0)) / q) > 1 && Math.abs(p - t / q) > 1
    })
    .map(
      (it) =>
        `${it.name}(전표 ${Math.round(it.unit_price!).toLocaleString('ko-KR')}원 · 계산 ${Math.round((it.line_total! + (it.tax ?? 0)) / Number(it.quantity)).toLocaleString('ko-KR')}원)`,
    )
}

// 사진과 대조한 값으로 확정 → 실제 기록(receipt_items)으로 반영하고, 시트가 연결돼 있으면 장부에도 바로 적음
export async function confirmReceipt(formData: FormData) {
  const me = await getCurrentProfile()
  const id = Number(formData.get('id'))
  const path = backPath(formData, id)
  let items: unknown
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]'))
  } catch {
    back(path, 'error', '품목 정보를 읽지 못했습니다.')
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
  if (error) back(path, 'error', error.message)
  // AI가 읽은 값과 다른 곳을 기록 → 다음 AI 읽기·장부 품목 추천에 씀
  await recordCorrections(id, items as Parameters<typeof recordCorrections>[1]).catch((err) =>
    console.error('recordCorrections failed', err),
  )

  let message = '확정했습니다.'
  const priceWarn = unitPriceWarnings(items)
  if (priceWarn.length) message += `\n⚠️ 전표 단가와 계산한 단가가 다른 품목: ${priceWarn.join(', ')}`
  if ((await getSheetSettings()).webhook_url) message += '\n' + ledgerMessage(await sendReceiptToSheet(id, me.id))
  back(path, 'ok', message)
}

export async function closeReceipt(formData: FormData) {
  const me = await getCurrentProfile()
  const id = Number(formData.get('id'))
  const path = backPath(formData, id)
  const status = formData.get('status') === 'void' ? 'void' : 'rejected'
  const supabase = await createClient()
  const { error } = await supabase.rpc('close_receipt', {
    p_id: id,
    p_status: status,
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back(path, 'error', error.message)
  if (status === 'rejected') back(path, 'ok', '반려했습니다.')

  // 무효: 장부에 더했던 금액과 단가 기록을 뺌
  let message = '무효 처리했습니다. 단가 비교에서 빠집니다.'
  const { count } = await supabase
    .from('receipt_sheet_exports')
    .select('receipt_id', { count: 'exact', head: true })
    .eq('receipt_id', id)
  if (count) {
    const reply = await sendReceiptToSheet(id, me.id, { undoOnly: true })
    message += reply.ok
      ? '\n매출 매입 장부에서도 이 전표 금액을 뺐습니다.'
      : `\n⚠️ 장부에서 금액을 빼지 못했습니다: ${reply.error}`
  }
  back(path, 'ok', message)
}

export async function retryReceipt(formData: FormData) {
  await getCurrentProfile()
  const id = Number(formData.get('id'))
  const path = backPath(formData, id)
  const supabase = await createClient()
  const { error } = await supabase.rpc('retry_receipt', { p_id: id })
  if (error) back(path, 'error', error.message)
  after(() => readReceipt(id))
  back(path, 'ok', 'AI가 다시 읽는 중입니다. 잠시 후 자동으로 바뀝니다.')
}

// 확정된 전표를 장부로 다시 보냄 (예전에 더한 금액은 빼고 다시 적음)
export async function sendToSheet(formData: FormData) {
  const me = await requireAdmin()
  const id = Number(formData.get('id'))
  const reply = await sendReceiptToSheet(id, me.id)
  back(backPath(formData, id), reply.ok ? 'ok' : 'error', ledgerMessage(reply))
}
