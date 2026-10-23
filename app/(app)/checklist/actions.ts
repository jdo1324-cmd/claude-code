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
  revalidatePath('/admin/checklist-items')
  revalidatePath('/sales')
  redirect(path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(message))
}

// 체크 / 숫자 입력 항목 완료
export async function completeItem(formData: FormData) {
  await getCurrentProfile()
  const raw = String(formData.get('value') ?? '')
    .replace(/,/g, '')
    .trim()
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
  revalidatePath('/admin/checklist-items')
  revalidatePath('/sales')
  return { error: error?.message ?? null }
}

// 비포·애프터 항목의 비포 사진 (브라우저에서 사진을 올린 뒤 호출). 애프터 사진으로 완료하기 전까지 다시 찍을 수 있음
export async function setBeforePhoto(itemId: number, photoPath: string): Promise<{ error: string | null }> {
  await getCurrentProfile()
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_checklist_before_photo', { p_item_id: itemId, p_photo_path: photoPath })
  revalidatePath('/checklist')
  revalidatePath('/admin/checklists')
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

// 체크한 요일 (0=일 … 6=토). 하나도 안 고르면 매일(null)
function weekdaysFrom(formData: FormData) {
  const days = formData
    .getAll('weekdays')
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return days.length === 0 || days.length === 7 ? null : days
}

export async function addItem(formData: FormData) {
  await requireOwner()
  const back = safePath(formData.get('back'), '/admin/checklists')
  const supabase = await createClient()
  const { error } = await supabase.rpc('upsert_checklist_item', {
    p_item_id: null,
    p_phase: String(formData.get('phase') ?? ''),
    p_category: String(formData.get('category') ?? ''),
    p_title: String(formData.get('title') ?? ''),
    p_item_type: String(formData.get('item_type') ?? ''),
    p_unit: String(formData.get('unit') ?? ''),
    p_is_required: formData.get('is_required') === 'on',
    p_weekdays: weekdaysFrom(formData),
    p_frequency: String(formData.get('frequency') ?? 'daily'),
    p_photo_mode: formData.get('before_after') === 'on' ? 'before_after' : 'single',
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

export async function updateItem(formData: FormData) {
  await requireOwner()
  const back = safePath(formData.get('back'), '/admin/checklist-items')
  const itemId = Number(formData.get('item_id'))
  const supabase = await createClient()
  const { data: newId, error } = await supabase.rpc('upsert_checklist_item', {
    p_item_id: itemId,
    p_phase: null,
    p_category: String(formData.get('category') ?? ''),
    p_title: String(formData.get('title') ?? ''),
    p_item_type: String(formData.get('item_type') ?? ''),
    p_unit: String(formData.get('unit') ?? ''),
    p_is_required: formData.get('is_required') === 'on',
    p_weekdays: weekdaysFrom(formData),
    p_frequency: String(formData.get('frequency') ?? 'daily'),
    p_photo_mode: formData.get('before_after') === 'on' ? 'before_after' : 'single',
  })
  if (error) backTo(back, 'error', error.message)
  backTo(
    back,
    'ok',
    Number(newId) !== itemId
      ? '종류·주기·사진 방식이 바뀌어 새 항목으로 만들고, 기존 항목은 사용 중지했습니다. (지난 기록은 그대로 남습니다)'
      : '항목을 수정했습니다.',
  )
}

export async function moveItem(formData: FormData) {
  await requireOwner()
  const back = safePath(formData.get('back'), '/admin/checklist-items')
  const supabase = await createClient()
  const { error } = await supabase.rpc('move_checklist_item', {
    p_item_id: Number(formData.get('item_id')),
    p_direction: formData.get('direction') === 'up' ? -1 : 1,
  })
  if (error) backTo(back, 'error', error.message)
  backTo(back, 'ok', '순서를 바꿨습니다.')
}
