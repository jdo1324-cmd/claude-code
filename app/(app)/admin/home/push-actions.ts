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
// 휴대폰이 받았는지 / 화면에 띄웠는지는 서비스 워커가 /api/push-ack 로 알려 옴 → getPushTest 로 확인
export async function sendTestPush(endpoint: string) {
  const me = await requireAdmin()
  const admin = createAdminClient()
  const { data: test } = await admin.from('push_tests').insert({ user_id: me.id }).select('id').single()
  const result = await notifyEndpoint(me.id, endpoint, {
    title: '알림 시험',
    body: '이 휴대폰으로 매장 알림이 옵니다.',
    url: '/admin/home',
    testId: test?.id,
  })
  if (test)
    await admin
      .from('push_tests')
      .update({ push_status: result?.status ?? null })
      .eq('id', test.id)
  if (!result) {
    return {
      ok: false,
      testId: null,
      message: '이 휴대폰이 알림 받는 기기로 등록되어 있지 않습니다. [끄기] 후 다시 켜 주세요.',
    }
  }
  if (result.ok)
    return { ok: true, testId: test?.id ?? null, message: `푸시 서버가 알림을 받았습니다 (응답 ${result.status}).` }
  if (result.status === 404 || result.status === 410) {
    return {
      ok: false,
      testId: null,
      message: '이 휴대폰의 알림 등록이 만료되었습니다. [이 휴대폰으로 알림 받기]를 다시 눌러 주세요.',
    }
  }
  return {
    ok: false,
    testId: null,
    message: `푸시 서버가 거절했습니다 (응답 ${result.status ?? '없음'}): ${result.detail ?? ''}`,
  }
}

export async function getPushTest(testId: string) {
  const me = await requireAdmin()
  const { data } = await createAdminClient()
    .from('push_tests')
    .select('received_at, shown_at, show_error')
    .eq('id', testId)
    .eq('user_id', me.id)
    .maybeSingle()
  return data as { received_at: string | null; shown_at: string | null; show_error: string | null } | null
}
