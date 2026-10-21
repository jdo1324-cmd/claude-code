'use server'

import { requireAdmin } from '@/lib/auth'
import { getVapidPublicKey, notifyUser } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

export async function getPushPublicKey() {
  await requireAdmin()
  return getVapidPublicKey()
}

// 이 휴대폰(브라우저)을 알림 받는 기기로 등록
export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string) {
  const me = await requireAdmin()
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { error: '알림 등록 정보가 올바르지 않습니다.' }
  }
  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .upsert(
      { user_id: me.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent.slice(0, 300) },
      { onConflict: 'endpoint' },
    )
  return { error: error?.message ?? null }
}

export async function removePushSubscription(endpoint: string) {
  const me = await requireAdmin()
  await createAdminClient().from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', me.id)
}

export async function sendTestPush() {
  const me = await requireAdmin()
  const sent = await notifyUser(me.id, {
    title: '알림 시험',
    body: '이 휴대폰으로 매장 알림이 옵니다.',
    url: '/admin/home',
  })
  return { sent }
}
