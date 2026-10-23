import 'server-only'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

type Vapid = { publicKey: string; privateKey: string }

// 웹 푸시 키: 처음 쓸 때 만들어 서버 전용 칸(store_settings)에 저장. 별도 환경변수 필요 없음.
async function getVapid(): Promise<Vapid> {
  const admin = createAdminClient()
  const { data } = await admin.from('store_settings').select('vapid_public, vapid_private').eq('id', 1).single()
  if (data?.vapid_public && data.vapid_private) {
    return { publicKey: data.vapid_public, privateKey: data.vapid_private }
  }
  const keys = webpush.generateVAPIDKeys()
  // 동시에 두 번 만들어도 먼저 저장된 하나만 쓰이도록
  await admin
    .from('store_settings')
    .update({ vapid_public: keys.publicKey, vapid_private: keys.privateKey })
    .eq('id', 1)
    .is('vapid_public', null)
  const { data: saved } = await admin.from('store_settings').select('vapid_public, vapid_private').eq('id', 1).single()
  return { publicKey: saved!.vapid_public!, privateKey: saved!.vapid_private! }
}

export async function getVapidPublicKey() {
  return (await getVapid()).publicKey
}

export type PushMessage = { title: string; body: string; url?: string }

function subject() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return host ? `https://${host}` : 'mailto:admin@example.com'
}

export type SendResult = { id: number; ok: boolean; status: number | null; detail?: string }

async function sendDetailed(
  subs: { id: number; endpoint: string; p256dh: string; auth: string }[],
  message: PushMessage,
): Promise<SendResult[]> {
  if (subs.length === 0) return []
  const vapid = await getVapid()
  webpush.setVapidDetails(subject(), vapid.publicKey, vapid.privateKey)
  const admin = createAdminClient()
  return Promise.all(
    subs.map(async (s): Promise<SendResult> => {
      try {
        const res = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: message.title, body: message.body, url: message.url ?? '/admin/home' }),
          { TTL: 60 * 60 * 12, urgency: 'high' },
        )
        return { id: s.id, ok: true, status: res.statusCode }
      } catch (err) {
        // 알림을 끈 휴대폰(404/410)은 목록에서 정리
        const e = err as { statusCode?: number; body?: string; message?: string }
        const status = e.statusCode ?? null
        if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('id', s.id)
        else console.error('push failed', status, err)
        return { id: s.id, ok: false, status, detail: (e.body || e.message || '').slice(0, 200) }
      }
    }),
  )
}

async function send(subs: { id: number; endpoint: string; p256dh: string; auth: string }[], message: PushMessage) {
  return (await sendDetailed(subs, message)).filter((r) => r.ok).length
}

// 사장/관리자(알림을 켠 사람)에게 보내기
export async function notifyAdmins(message: PushMessage) {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, profiles!inner(role, is_active)')
      .in('profiles.role', ['owner', 'manager'])
      .eq('profiles.is_active', true)
    return await send(
      (data ?? []) as unknown as { id: number; endpoint: string; p256dh: string; auth: string }[],
      message,
    )
  } catch (err) {
    console.error('notifyAdmins failed', err)
    return 0
  }
}

export async function notifyUser(userId: string, message: PushMessage) {
  const admin = createAdminClient()
  const { data } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId)
  return send(data ?? [], message)
}

// 시험 알림: 기기 하나에만 보내고 푸시 서버의 응답을 그대로 돌려줌
export async function notifyEndpoint(userId: string, endpoint: string, message: PushMessage) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
  if (!data || data.length === 0) return null
  return (await sendDetailed(data, message))[0]
}
