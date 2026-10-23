import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// 휴대폰의 서비스 워커가 시험 알림을 받았다/띄웠다고 알려 오는 곳.
// 로그인 쿠키 없이도 오므로(잠금 상태 등), 추측할 수 없는 시험 번호(uuid)로만 기록하고 10분 지난 시험은 무시.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { id?: string; stage?: string; error?: string } | null
  if (!body?.id || !UUID.test(body.id) || !['received', 'shown', 'error'].includes(body.stage ?? '')) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const now = new Date().toISOString()
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const update =
    body.stage === 'received'
      ? { received_at: now }
      : body.stage === 'shown'
        ? { shown_at: now }
        : { show_error: String(body.error ?? '알 수 없는 오류').slice(0, 300) }
  await createAdminClient().from('push_tests').update(update).eq('id', body.id).gte('sent_at', since)
  return NextResponse.json({ ok: true })
}
