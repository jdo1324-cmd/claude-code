'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireOwner } from '@/lib/auth'
import { getJandiWebhook, isValidJandiUrl, postJandi } from '@/lib/jandi'
import { createAdminClient } from '@/lib/supabase/admin'

function back(key: 'ok' | 'error', message: string): never {
  revalidatePath('/admin/jandi')
  redirect('/admin/jandi?' + key + '=' + encodeURIComponent(message))
}

export async function saveJandiWebhook(formData: FormData) {
  const me = await requireOwner()
  const url = String(formData.get('webhook_url') ?? '').trim()
  if (!isValidJandiUrl(url)) {
    back(
      'error',
      '주소가 올바르지 않습니다. 잔디에서 발급한 https://wh.jandi.com/connect-api/team-webhook/… 주소를 붙여 넣어 주세요.',
    )
  }
  const { error } = await createAdminClient()
    .from('jandi_settings')
    .update({ webhook_url: url, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) back('error', '저장하지 못했습니다: ' + error.message)
  back('ok', '잔디 웹훅 주소를 저장했습니다. 아래에서 받을 사람을 정하고 [시험 보내기]를 눌러 보세요.')
}

// 받을 사람: 사장/관리자별 잔디 이메일과 받기 여부
export async function saveJandiRecipients(formData: FormData) {
  await requireOwner()
  const admin = createAdminClient()
  const ids = formData.getAll('user_id').map(String)
  const rows: { user_id: string; email: string; enabled: boolean; updated_at: string }[] = []
  for (const id of ids) {
    const email = String(formData.get(`email_${id}`) ?? '').trim()
    if (!email) continue
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) back('error', `이메일 형식이 올바르지 않습니다: ${email}`)
    rows.push({
      user_id: id,
      email,
      enabled: formData.get(`enabled_${id}`) === 'on',
      updated_at: new Date().toISOString(),
    })
  }
  // 이메일을 지운 사람은 목록에서 뺌
  const keep = new Set(rows.map((r) => r.user_id))
  const removed = ids.filter((id) => !keep.has(id))
  if (removed.length) await admin.from('jandi_recipients').delete().in('user_id', removed)
  if (rows.length) {
    const { error } = await admin.from('jandi_recipients').upsert(rows, { onConflict: 'user_id' })
    if (error) back('error', '저장하지 못했습니다: ' + error.message)
  }
  back('ok', `받을 사람을 저장했습니다. (받기 켬 ${rows.filter((r) => r.enabled).length}명)`)
}

export async function testJandi() {
  await requireOwner()
  const url = await getJandiWebhook()
  if (!url) back('error', '먼저 잔디 웹훅 주소를 저장해 주세요.')
  const { data } = await createAdminClient().from('jandi_recipients').select('email').eq('enabled', true)
  const emails = ((data ?? []) as { email: string }[]).map((r) => r.email)
  const result = await postJandi(url!, emails, {
    title: '알림 시험',
    body: `매장관리 앱에서 보낸 시험 메시지입니다. (${emails.length}명에게)`,
    url: '/admin/home',
  })
  if (!result.ok) back('error', `잔디가 받지 않았습니다 (응답 ${result.status ?? '없음'}). ${result.detail ?? ''}`)
  back('ok', `잔디로 보냈습니다: ${emails.join(', ') || '(토픽)'} — 잔디 앱에서 확인해 보세요.`)
}
