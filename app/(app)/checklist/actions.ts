'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentProfile, requireOwner } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

function safePath(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value ?? '')
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : fallback
}

function backTo(path: string, key: 'ok' | 'error', message: string): never {
  revalidatePath('/checklist')
  revalidatePath('/admin/checklists')
  revalidatePath('/sales')
  redirect(path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(message))
}

// 체크 / 숫자 입력 항목 완료
export async function completeItem(formData: FormData) {
  await getCurrentProfile()
  const raw = String(formData.get('value') ?? '').replace(/,/g, '').trim()
  const value = raw === '' ? null : Number(raw)
  if (value !== null && Number.isNaN(value)) backTo('/checklist', 'error', '숫자만 입력하세요.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('complete_checklist_item', {
    p_item_id: Number(formData.get('item_id')),
    p_value: value,
    p_photo_path: null,
    p_note: String(formData.get('note') ?? ''),
  })
  if (error) backTo('/checklist', 'error', error.message)
  backTo('/checklist', 'ok', '완료했습니다.')
}

// 사진 항목 완료 (브라우저에서 사진을 올린 뒤 호출)
export async function completePhotoItem(itemId: number, photoPath: string): Promise<{ error: string | null }> {
  await getCurrentProfile()
  const supabase = await createClient()
  const { error } = await supabase.rpc('complete_checklist_item', {
    p_item_id: itemId,
    p_value: null,
    p_photo_path: photoPath,
    p_note: null,
  })
  revalidatePath('/checklist')
  revalidatePath('/admin/checklists')
  revalidatePath('/sales')
  return { error: error?.message ?? null }
}

// 잘못 체크한 것 취소 (기록은 "취소됨"으로 남음)
export async function voidEntry(formData: FormData) {
  await getCurrentProfile()
  const back = safePath(formData.get('back'), '/checklist')
  const supabase = await createClient()
  const { error } = await supabase.rpc('void_checklist_entry', {
    p_entry_id: Number(formData.get('entry_id')),
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) backTo(back, 'error', error.message)
  backTo(back, 'ok', '취소했습니다. 기록에는 "취소됨"으로 남습니다.')
}

// ---------- 항목 관리 (사장) ----------

export async function addItem(formData: FormData) {
  await requireOwner()
  const back = safePath(formData.get('back'), '/admin/checklists')
  const supabase = await createClient()
  const { error } = await supabase.rpc('add_checklist_item', {
    p_phase: String(formData.get('phase') ?? ''),
    p_category: String(formData.get('category') ?? ''),
    p_title: String(formData.get('title') ?? ''),
    p_item_type: String(formData.get('item_type') ?? ''),
    p_unit: String(formData.get('unit') ?? ''),
    p_is_required: formData.get('is_required') === 'on',
  })
  if (error) backTo(back, 'error', error.message)
  backTo(back, 'ok', '항목을 추가했습니다.')
}

export async function setItemActive(formData: FormData) {
  await requireOwner()
  const back = safePath(formData.get('back'), '/admin/checklists')
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_checklist_item_active', {
    p_item_id: Number(formData.get('item_id')),
    p_active: formData.get('active') === '1',
  })
  if (error) backTo(back, 'error', error.message)
  backTo(back, 'ok', formData.get('active') === '1' ? '항목을 다시 사용합니다.' : '항목을 사용 중지했습니다.')
}
