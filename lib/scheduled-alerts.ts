import 'server-only'
import { ALERT_KINDS, SUMMARY_KIND_LABEL } from '@/lib/alert-settings'
import { findAlerts } from '@/lib/alerts'
import { PHASES, PHASE_LABEL, appliesOn, periodRange, type ChecklistItem } from '@/lib/checklist'
import { notifyAdmins } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>
export type SummaryKind = keyof typeof SUMMARY_KIND_LABEL

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// 체크리스트 미완료: 오늘 아직 안 된 항목 (주간·월간은 그 주/그 달에 아직 안 한 것)
export async function runChecklistReminder(admin: Admin, today: string) {
  // 오늘 아무도 출근하지 않았으면(휴무일) 보내지 않음
  const { count } = await admin
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('work_date', today)
    .eq('status', 'valid')
  if (!count) return { skipped: 'no attendance today' }

  const monthStart = periodRange('monthly', today).start
  const weekStart = periodRange('weekly', today).start
  const from = monthStart < weekStart ? monthStart : weekStart
  const [{ data: itemData }, { data: entryData }] = await Promise.all([
    admin.from('checklist_items').select('*').eq('is_active', true).order('phase').order('sort_order'),
    admin
      .from('checklist_entries')
      .select('item_id, work_date')
      .eq('status', 'valid')
      .gte('work_date', from)
      .lte('work_date', today),
  ])
  const entries = (entryData ?? []) as { item_id: number; work_date: string }[]
  const isDone = (i: ChecklistItem) => {
    const { start } = periodRange(i.frequency, today)
    return entries.some((e) => e.item_id === i.id && e.work_date >= start && e.work_date <= today)
  }
  const missing = ((itemData ?? []) as ChecklistItem[]).filter((i) => appliesOn(i, today) && !isDone(i))
  if (missing.length === 0) return { missing: 0 }

  const daily = missing.filter((i) => i.frequency === 'daily')
  const required = daily.filter((i) => i.is_required)
  const optional = daily.filter((i) => !i.is_required)
  const lines = PHASES.map((phase) => {
    const req = required.filter((i) => i.phase === phase)
    return req.length ? `• ${PHASE_LABEL[phase].replace(' 업무', '')}: ${req.map((i) => i.title).join(', ')}` : null
  }).filter((l): l is string => !!l)
  if (optional.length) lines.push(`• 선택 항목: ${optional.map((i) => i.title).join(', ')}`)
  const weekly = missing.filter((i) => i.frequency === 'weekly')
  const monthly = missing.filter((i) => i.frequency === 'monthly')
  if (weekly.length) lines.push(`• 이번 주 남은 업무: ${weekly.map((i) => i.title).join(', ')}`)
  if (monthly.length) lines.push(`• 이번 달 남은 업무: ${monthly.map((i) => i.title).join(', ')}`)

  await notifyAdmins({
    kind: 'checklist_reminder',
    title: required.length ? `체크리스트 필수 ${required.length}개 미완료` : `체크리스트 미완료 ${missing.length}개`,
    body: lines.join('\n'),
    url: `/admin/checklists?date=${today}`,
  })
  return { required: required.length, missing: missing.length }
}

// 놓친 일 점검 (종류별로 따로): 어제·오늘 생긴 그 종류의 일 중 아직 알리지 않은 것.
// 보낼 시각 이후에 생긴 일(예: 밤 21:30 자동 퇴근)은 다음 날 같은 알림에 [날짜]를 붙여 보냄
export async function runSummaryKind(admin: Admin, today: string, kind: SummaryKind) {
  const label = SUMMARY_KIND_LABEL[kind]
  const yesterday = addDays(today, -1)
  const alerts = (await findAlerts(admin, today, 2)).filter((a) => a.date >= yesterday && a.kind === label)
  const keyOf = (a: (typeof alerts)[number]) => `${a.date}|${a.kind}|${a.message}|${a.people.join(',')}`
  const { data: sentData } = await admin.from('alert_sent_keys').select('key').in('key', alerts.map(keyOf))
  const sent = new Set(((sentData ?? []) as { key: string }[]).map((r) => r.key))
  const fresh = alerts.filter((a) => !sent.has(keyOf(a)))
  if (fresh.length === 0) return { alerts: 0 }

  const md = (d: string) => (d === today ? '오늘' : `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`)
  const lines = fresh.slice(0, 8).map((a) => `• ${md(a.date)}: ${a.people.length ? a.people.join(', ') : a.message}`)
  await notifyAdmins({
    kind,
    title: `${ALERT_KINDS[kind].label} ${fresh.length}건`,
    body: lines.join('\n') + (fresh.length > 8 ? `\n외 ${fresh.length - 8}건` : ''),
    url: fresh[0].href,
  })
  await admin.from('alert_sent_keys').upsert(
    fresh.map((a) => ({ key: keyOf(a) })),
    { onConflict: 'key', ignoreDuplicates: true },
  )
  return { alerts: fresh.length }
}
