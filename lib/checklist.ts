import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type Phase = 'open' | 'close'
export type ItemType = 'check' | 'number' | 'photo'

export type ChecklistItem = {
  id: number
  phase: Phase
  category: string
  title: string
  item_type: ItemType
  unit: string | null
  is_required: boolean
  sort_order: number
  is_active: boolean
}

export type ChecklistEntry = {
  id: number
  work_date: string
  item_id: number
  value_number: number | null
  photo_path: string | null
  note: string | null
  done_by: string
  done_at: string
  status: 'valid' | 'void'
  voided_by: string | null
  voided_at: string | null
  void_reason: string | null
}

export const PHASES: Phase[] = ['open', 'close']
export const PHASE_LABEL = { open: '오픈 업무', close: '마감 업무' } as const
export const TYPE_LABEL = { check: '✔ 체크', number: '🔢 숫자 입력', photo: '📷 사진 필수' } as const
export const PHOTO_BUCKET = 'checklist-photos'

// 그날의 체크리스트 전체: 항목, 기록(취소 포함), 사진 주소, 직원 이름
export async function loadChecklist(supabase: Supabase, date: string) {
  const [{ data: itemData }, { data: entryData }, { data: nameData }] = await Promise.all([
    supabase.from('checklist_items').select('*').order('phase').order('sort_order'),
    supabase.from('checklist_entries').select('*').eq('work_date', date).order('done_at'),
    supabase.rpc('member_names'),
  ])
  const entries = (entryData ?? []) as ChecklistEntry[]
  const usedItemIds = new Set(entries.map((e) => e.item_id))
  // 사용 중인 항목 + (사용 중지됐어도) 그날 기록이 있는 항목
  const items = ((itemData ?? []) as ChecklistItem[]).filter((i) => i.is_active || usedItemIds.has(i.id))

  const names: Record<string, string> = {}
  for (const n of (nameData ?? []) as { id: string; full_name: string }[]) names[n.id] = n.full_name

  const photoPaths = entries.map((e) => e.photo_path).filter((p): p is string => !!p)
  const photoUrls: Record<string, string> = {}
  if (photoPaths.length) {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(photoPaths, 60 * 60)
    for (const s of data ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl
  }

  return { items, entries, names, photoUrls }
}

export function progress(items: ChecklistItem[], entries: ChecklistEntry[], phase: Phase) {
  const phaseItems = items.filter((i) => i.phase === phase && i.is_active)
  const done = (i: ChecklistItem) => entries.some((e) => e.item_id === i.id && e.status === 'valid')
  const required = phaseItems.filter((i) => i.is_required)
  return {
    requiredDone: required.filter(done).length,
    requiredTotal: required.length,
    allDone: phaseItems.filter(done).length,
    allTotal: phaseItems.length,
  }
}

// 항목들을 업무 구분(category)별로 묶음 (순서 유지)
export function groupByCategory(items: ChecklistItem[]) {
  const groups: { category: string; items: ChecklistItem[] }[] = []
  for (const item of items) {
    const group = groups.find((g) => g.category === item.category)
    if (group) group.items.push(item)
    else groups.push({ category: item.category, items: [item] })
  }
  return groups
}

export function formatValue(item: ChecklistItem, entry: ChecklistEntry) {
  if (entry.value_number === null) return ''
  return `${Number(entry.value_number).toLocaleString('ko-KR')}${item.unit ?? ''}`
}
