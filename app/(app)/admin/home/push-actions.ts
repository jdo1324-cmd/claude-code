'use server'

import { requireAdmin } from '@/lib/auth'
import { getVapidPublicKey, notifyEndpoint } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/admin'

export async function getPushPublicKey() {
  await requireAdmin()
  return getVapidPublicKey()
}

// 이 휴대폰(브라우저)을 알림 받는 기기로 등록
export async function savePushSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string,
) {
  const me = await requireAdmin()
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { error: '알림 등록 정보가 올바르지 않습니다.' }
  }
  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .upsert(
      {
        user_id: me.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: userAgent.slice(0, 300),
      },
      { onConflict: 'endpoint' },
    )
  return { error: error?.message ?? null }
}

export async function removePushSubscription(endpoint: string) {
  const me = await requireAdmin()
  await createAdminClient().from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', me.id)
}

// 지금 이 휴대폰으로 시험 알림 (등록 정보가 서버에 없으면 다시 등록하라고 알려 줌)
export async function sendTestPush(endpoint: string) {
  const me = await requireAdmin()
  const result = await notifyEndpoint(me.id, endpoint, {
    title: '알림 시험',
    body: '이 휴대폰으로 매장 알림이 옵니다.',
    url: '/admin/home',
  })
  if (!result)
    return { ok: false, message: '이 휴대폰이 알림 받는 기기로 등록되어 있지 않습니다. [끄기] 후 다시 켜 주세요.' }
  if (result.ok)
    return {
      ok: true,
      message: `푸시 서버가 알림을 받았습니다 (응답 ${result.status}). 몇 초 안에 휴대폰에 떠야 합니다.`,
    }
  if (result.status === 404 || result.status === 410) {
    return {
      ok: false,
      message: '이 휴대폰의 알림 등록이 만료되었습니다. [이 휴대폰으로 알림 받기]를 다시 눌러 주세요.',
    }
  }
  return { ok: false, message: `푸시 서버가 거절했습니다 (응답 ${result.status ?? '없음'}): ${result.detail ?? ''}` }
}
