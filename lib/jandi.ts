import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// 잔디 팀 웹훅(유료 플랜)으로 사장/관리자에게 1:1 메시지 보내기.
// 받는 사람은 잔디에 로그인하는 이메일로 지정 (쉼표로 여러 명, 한 번에 최대 100명).

// 잔디 웹훅 주소만 허용 (다른 곳으로 알림 내용이 새지 않게)
const WEBHOOK_PATTERN = /^https:\/\/wh\.jandi\.com\/connect-api\/(team-webhook|webhook)\/\d+\/[A-Za-z0-9]+$/

export function isValidJandiUrl(url: string) {
  return WEBHOOK_PATTERN.test(url)
}

export function isTeamWebhook(url: string) {
  return url.includes('/team-webhook/')
}

export type JandiMessage = { title: string; body: string; url?: string; color?: string }

function appUrl(path: string) {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'store-ops-tau.vercel.app'
  return `https://${host}${path.startsWith('/') ? path : `/${path}`}`
}

export async function getJandiWebhook() {
  const { data } = await createAdminClient().from('jandi_settings').select('webhook_url').eq('id', 1).single()
  return (data?.webhook_url as string | null) ?? null
}

// 잔디로 보내고 결과를 돌려줌
export async function postJandi(webhookUrl: string, emails: string[], message: JandiMessage) {
  const link = message.url ? appUrl(message.url) : null
  const payload: Record<string, unknown> = {
    body: `**${message.title}**\n${message.body}${link ? `\n[👉 앱에서 확인](${link})` : ''}`,
    connectColor: message.color ?? '#1F6B52',
  }
  // 팀 웹훅이면 받는 사람(이메일)을 지정해 1:1로. 토픽 웹훅이면 그 토픽에 올라감.
  if (isTeamWebhook(webhookUrl)) {
    if (emails.length === 0) return { ok: false, status: null, detail: '받을 사람이 없습니다.' }
    payload.email = emails.slice(0, 100).join(',')
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { Accept: 'application/vnd.tosslab.jandi-v2+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, detail: res.ok ? undefined : text.slice(0, 200) }
  } catch (err) {
    return { ok: false, status: null, detail: err instanceof Error ? err.message : '잔디에 연결하지 못했습니다.' }
  }
}

// 잔디로 받기로 한 사장/관리자 모두에게
export async function notifyAdminsJandi(message: JandiMessage) {
  try {
    const admin = createAdminClient()
    const webhookUrl = await getJandiWebhook()
    if (!webhookUrl) return null
    const { data } = await admin
      .from('jandi_recipients')
      .select('email, profiles!inner(role, is_active)')
      .eq('enabled', true)
      .in('profiles.role', ['owner', 'manager'])
      .eq('profiles.is_active', true)
    const emails = ((data ?? []) as { email: string }[]).map((r) => r.email)
    const result = await postJandi(webhookUrl, emails, message)
    if (!result.ok) console.error('jandi failed', result.status, result.detail)
    return result
  } catch (err) {
    console.error('notifyAdminsJandi failed', err)
    return null
  }
}
