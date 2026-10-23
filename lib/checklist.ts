import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type Phase = 'open' | 'middle' | 'close'
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
  weekdays: number[] | null // 하는 요일 (0=일 … 6=토). null 이면 매일 (주기가 "매일"일 때만)
  frequency: Frequency // 매일 / 주간(그 주 안에 한 번) / 월간(그 달 안에 한 번)
  photo_mode: 'single' | 'before_after' // 사진 항목: 1장 / 비포·애프터 2장
}

export type Frequency = 'daily' | 'weekly' | 'monthly'
export const FREQUENCY_LABEL = { daily: '매일', weekly: '주간', monthly: '월간' } as const

export type BeforePhoto = { item_id: number; period_start: string; photo_path: string; uploaded_by: string }

export type ChecklistEntry = {
  id: number
  work_date: string
  item_id: number
  value_number: number | null
  photo_path: string | null
  photo_before_path: string | null
  note: string | null
  done_by: string
  done_at: string
  status: 'valid' | 'void'
  voided_by: string | null
  voided_at: string | null
  void_reason: string | null
}

export const PHASES: Phase[] = ['open', 'middle', 'close']
export const PHASE_LABEL = { open: '오픈 업무', middle: '미들 업무', close: '마감 업무' } as const

// 요일 (화면에는 월요일부터)
export const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'] as const
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export function weekdaysLabel(days: number[] | null) {
  if (!days || days.length === 0 || days.length === 7) return '매일'
  return WEEKDAY_ORDER.filter((d) => days.includes(d))
    .map((d) => WEEKDAY_LABEL[d])
    .join('·')
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// 주기의 첫날·마지막날: 매일=그날, 주간=월~일, 월간=1일~말일 (DB의 checklist_period_start 와 같은 기준)
export function periodRange(frequency: Frequency, date: string) {
  if (frequency === 'weekly') {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay() || 7 // 월=1 … 일=7
    const start = addDays(date, 1 - dow)
    return { start, end: addDays(start, 6) }
  }
  if (frequency === 'monthly') {
    const start = `${date.slice(0, 7)}-01`
    const [y, m] = date.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { start, end: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` }
  }
  return { start: date, end: date }
}

// 그날(YYYY-MM-DD) 하는 항목인지. 주간·월간 항목은 그 주/그 달 내내 보임
export function appliesOn(item: Pick<ChecklistItem, 'weekdays'> & { frequency?: Frequency }, date: string) {
  if (item.frequency && item.frequency !== 'daily') return true
  if (!item.weekdays || item.weekdays.length === 0) return true
  return item.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())
}

// 화면에 보일 주기 설명: "매일", "월·수·금", "주간 (10/20~10/26 중 한 번)"
export function scheduleLabel(item: Pick<ChecklistItem, 'weekdays' | 'frequency'>, date?: string) {
  if (item.frequency === 'daily') return weekdaysLabel(item.weekdays)
  if (!date) return item.frequency === 'weekly' ? '주간 (주 1회)' : '월간 (월 1회)'
  const { start, end } = periodRange(item.frequency, date)
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`
  return `${FREQUENCY_LABEL[item.frequency]} (${md(start)}~${md(end)} 중 한 번)`
}
export const TYPE_LABEL = { check: '✔ 체크', number: '🔢 숫자 입력', photo: '📷 사진 필수' } as const
export const PHOTO_BUCKET = 'checklist-photos'

// 그날의 체크리스트 전체: 항목, 기록(취소 포함), 비포 사진, 사진 주소, 직원 이름
// 주간·월간 항목은 그 주/그 달 안에 한 번 완료하면 남은 날에도 "완료"로 보이도록, 그 기간의 기록도 함께 가져옴
export async function loadChecklist(supabase: Supabase, date: string) {
  const monthStart = periodRange('monthly', date).start
  const weekStart = periodRange('weekly', date).start
  const from = monthStart < weekStart ? monthStart : weekStart
  const [{ data: itemData }, { data: entryData }, { data: periodData }, { data: beforeData }, { data: nameData }] =
    await Promise.all([
      supabase.from('checklist_items').select('*').order('phase').order('sort_order'),
      supabase.from('checklist_entries').select('*').eq('work_date', date).order('done_at'),
      supabase
        .from('checklist_entries')
        .select('*')
        .eq('status', 'valid')
        .gte('work_date', from)
        .lt('work_date', date)
        .order('done_at'),
      supabase.from('checklist_before_photos').select('*').gte('period_start', from).lte('period_start', date),
      supabase.rpc('member_names'),
    ])
  const allItems = (itemData ?? []) as ChecklistItem[]
  const itemById = new Map(allItems.map((i) => [i.id, i]))

  // 오늘 기록 + (주간·월간 항목이면) 같은 주/같은 달에 먼저 완료한 기록
  const earlier = ((periodData ?? []) as ChecklistEntry[]).filter((e) => {
    const item = itemById.get(e.item_id)
    return !!item && item.frequency !== 'daily' && e.work_date >= periodRange(item.frequency, date).start
  })
  const entries = [...earlier, ...((entryData ?? []) as ChecklistEntry[])]
  const usedItemIds = new Set(entries.map((e) => e.item_id))
  // 그날 하는 사용 중인 항목 + (사용 중지됐거나 다른 요일 항목이어도) 그날 기록이 있는 항목
  const items = allItems.filter((i) => (i.is_active && appliesOn(i, date)) || usedItemIds.has(i.id))

  // 아직 완료 전인 비포 사진 (그 항목의 이번 주기 것만)
  const beforePhotos = ((beforeData ?? []) as BeforePhoto[]).filter((b) => {
    const item = itemById.get(b.item_id)
    return !!item && b.period_start === periodRange(item.frequency, date).start
  })

  const names: Record<string, string> = {}
  for (const n of (nameData ?? []) as { id: string; full_name: string }[]) names[n.id] = n.full_name

  const photoPaths = [
    ...entries.flatMap((e) => [e.photo_path, e.photo_before_path]),
    ...beforePhotos.map((b) => b.photo_path),
  ].filter((p): p is string => !!p)
  const photoUrls: Record<string, string> = {}
  if (photoPaths.length) {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls([...new Set(photoPaths)], 60 * 60)
    for (const s of data ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl
  }

  return { items, entries, beforePhotos, names, photoUrls }
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
