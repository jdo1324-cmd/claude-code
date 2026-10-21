import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { findAlerts } from '@/lib/alerts'
import { todayKST } from '@/lib/format'
import { notifyAdmins } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

// 매일 22:00(한국) Supabase pg_cron 이 호출 → 오늘 놓친 일을 사장님 휴대폰으로 알림
export async function POST(request: NextRequest) {
  const admin = createAdminClient()
  const { data } = await admin.from('store_settings').select('cron_secret').eq('id', 1).single()
  const expected = Buffer.from(`Bearer ${data?.cron_secret ?? ''}`)
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  if (!data?.cron_secret || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const today = todayKST()
  const alerts = (await findAlerts(admin, today, 1)).filter((a) => a.date === today)
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
