import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Supabase pg_cron 이 보내는 비밀값(store_settings.cron_secret) 확인
export async function isCronRequest(request: NextRequest) {
  const { data } = await createAdminClient().from('store_settings').select('cron_secret').eq('id', 1).single()
  const expected = Buffer.from(`Bearer ${data?.cron_secret ?? ''}`)
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  return !!data?.cron_secret && expected.length === given.length && timingSafeEqual(expected, given)
}
