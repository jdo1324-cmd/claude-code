import 'server-only'
import { findAlerts } from '@/lib/alerts'
import { PHASES, PHASE_LABEL, appliesOn, periodRange, type ChecklistItem } from '@/lib/checklist'
import { notifyAdmins } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

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

// 놓친 일 점검: 어제·오늘 생긴 일 중 아직 알리지 않은 것 (체크리스트 미완료는 위 알림에서)
export async function runDailySummary(admin: Admin, today: string) {
  const yesterday = addDays(today, -1)
  const alerts = (await findAlerts(admin, today, 2)).filter((a) => a.date >= yesterday && a.kind !== '필수 업무 누락')
  const keyOf = (a: (typeof alerts)[number]) => `${a.date}|${a.kind}|${a.message}|${a.people.join(',')}`
  const { data: sentData } = await admin.from('alert_sent_keys').select('key').in('key', alerts.map(keyOf))
  const sent = new Set(((sentData ?? []) as { key: string }[]).map((r) => r.key))
  const fresh = alerts.filter((a) => !sent.has(keyOf(a)))
  if (fresh.length === 0) return { alerts: 0 }

  const md = (d: string) => (d === today ? '' : `[${Number(d.slice(5, 7))}/${Number(d.slice(8))}] `)
  const summary = fresh
    .slice(0, 6)
    .map((a) => `• ${md(a.date)}${a.kind}${a.people.length ? ` (${a.people.join(', ')})` : ''}`)
    .join('\n')
  await notifyAdmins({
    kind: 'daily_summary',
    title: `확인할 일 ${fresh.length}건`,
    body: summary + (fresh.length > 6 ? `\n외 ${fresh.length - 6}건` : ''),
    url: '/admin/home',
  })
  await admin.from('alert_sent_keys').upsert(
    fresh.map((a) => ({ key: keyOf(a) })),
    { onConflict: 'key', ignoreDuplicates: true },
  )
  return { alerts: fresh.length }
}
