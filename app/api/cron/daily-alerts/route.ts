import { NextResponse, type NextRequest } from 'next/server'
import { findAlerts } from '@/lib/alerts'
import { isCronRequest } from '@/lib/cron'
import { todayKST } from '@/lib/format'
import { notifyAdmins } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

// 매일 22:00(한국) Supabase pg_cron 이 호출 → 오늘 놓친 일(퇴근 태그 누락, 휴게시간 미입력, 매출 보고서 미제출,
// 사진 없는 완료)을 사장/관리자에게 알림. 체크리스트 미완료는 20:30 에 따로 보냄.
export async function POST(request: NextRequest) {
  if (!(await isCronRequest(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const today = todayKST()
  // 체크리스트 미완료는 20:30 알림(checklist-reminder)으로 따로 보냄
  const alerts = (await findAlerts(admin, today, 1)).filter((a) => a.date === today && a.kind !== '필수 업무 누락')
  if (alerts.length === 0) return NextResponse.json({ ok: true, alerts: 0 })

  const summary = alerts
    .slice(0, 4)
    .map((a) => `• ${a.kind}${a.people.length ? ` (${a.people.join(', ')})` : ''}`)
    .join('\n')
  const sent = await notifyAdmins({
    title: `오늘 확인할 일 ${alerts.length}건`,
    body: summary + (alerts.length > 4 ? `\n외 ${alerts.length - 4}건` : ''),
    url: '/admin/home',
  })
  return NextResponse.json({ ok: true, alerts: alerts.length, sent })
}
