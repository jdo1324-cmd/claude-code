import { NextResponse, type NextRequest } from 'next/server'
import { getAlertSettings } from '@/lib/alert-settings'
import { isCronRequest } from '@/lib/cron'
import { todayKST } from '@/lib/format'
import { runChecklistReminder, runDailySummary } from '@/lib/scheduled-alerts'
import { createAdminClient } from '@/lib/supabase/admin'

const JOBS = { checklist_reminder: runChecklistReminder, daily_summary: runDailySummary } as const

// 지금 한국 시각 'HH:MM'
function nowKstHHMM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date())
    .replace(/^24/, '00')
}

// Supabase pg_cron 이 5분마다 호출 → 알림 설정의 "보낼 시각"이 지난 알림을 그날 한 번만 보냄
export async function POST(request: NextRequest) {
  if (!(await isCronRequest(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const today = todayKST()
  const now = nowKstHHMM()
  const results: Record<string, unknown> = {}

  for (const s of await getAlertSettings()) {
    const job = JOBS[s.kind as keyof typeof JOBS]
    if (!job || !s.enabled || !s.send_time || now < s.send_time.slice(0, 5)) continue
    // 먼저 "오늘 보냄"을 기록 (5분마다 겹쳐 불려도 한 번만 보내도록)
    const { data: claimed } = await admin
      .from('alert_runs')
      .upsert({ kind: s.kind, run_date: today }, { onConflict: 'kind,run_date', ignoreDuplicates: true })
      .select('kind')
    if (!claimed || claimed.length === 0) continue
    try {
      results[s.kind] = await job(admin, today)
    } catch (err) {
      console.error('scheduled alert failed', s.kind, err)
      results[s.kind] = { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return NextResponse.json({ ok: true, now, results })
}
