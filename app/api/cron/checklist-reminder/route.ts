import { NextResponse, type NextRequest } from 'next/server'
import { PHASES, PHASE_LABEL, appliesOn, type ChecklistItem } from '@/lib/checklist'
import { isCronRequest } from '@/lib/cron'
import { todayKST } from '@/lib/format'
import { notifyAdmins } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

// 매일 20:30(한국) Supabase pg_cron 이 호출 → 오늘 체크리스트 중 아직 안 된 항목을 사장/관리자에게 알림
export async function POST(request: NextRequest) {
  if (!(await isCronRequest(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const today = todayKST()

  // 오늘 아무도 출근하지 않았으면(휴무일) 보내지 않음
  const { count } = await admin
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('work_date', today)
    .eq('status', 'valid')
  if (!count) return NextResponse.json({ ok: true, skipped: 'no attendance today' })

  const [{ data: itemData }, { data: entryData }] = await Promise.all([
    admin.from('checklist_items').select('*').eq('is_active', true).order('phase').order('sort_order'),
    admin.from('checklist_entries').select('item_id').eq('work_date', today).eq('status', 'valid'),
  ])
  const done = new Set(((entryData ?? []) as { item_id: number }[]).map((e) => e.item_id))
  // 오늘 하는 요일의 항목 중 아직 안 된 것
  const missing = ((itemData ?? []) as ChecklistItem[]).filter((i) => appliesOn(i, today) && !done.has(i.id))
  if (missing.length === 0) return NextResponse.json({ ok: true, missing: 0 })

  const required = missing.filter((i) => i.is_required)
  const optional = missing.filter((i) => !i.is_required)
  const lines = PHASES.map((phase) => {
    const req = required.filter((i) => i.phase === phase)
    return req.length ? `• ${PHASE_LABEL[phase].replace(' 업무', '')}: ${req.map((i) => i.title).join(', ')}` : null
  }).filter(Boolean)
  if (optional.length) lines.push(`• 선택 항목 ${optional.length}개: ${optional.map((i) => i.title).join(', ')}`)

  await notifyAdmins({
    title: required.length
      ? `체크리스트 필수 ${required.length}개 미완료`
      : `체크리스트 선택 항목 ${optional.length}개 미완료`,
    body: lines.join('\n'),
    url: `/admin/checklists?date=${today}`,
  })
  return NextResponse.json({ ok: true, required: required.length, optional: optional.length })
}
