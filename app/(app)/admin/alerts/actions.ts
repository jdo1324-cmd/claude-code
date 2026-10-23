'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ALERT_KINDS, type AlertKind } from '@/lib/alert-settings'
import { requireOwner } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayKST } from '@/lib/format'

export async function saveAlertSettings(formData: FormData) {
  const me = await requireOwner()
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const rows = (Object.keys(ALERT_KINDS) as AlertKind[]).map((kind) => {
    const raw = String(formData.get(`time_${kind}`) ?? '')
    const time = ALERT_KINDS[kind].scheduled && /^\d{2}:\d{2}$/.test(raw) ? raw : null
    if (ALERT_KINDS[kind].scheduled && !time) {
      redirect('/admin/alerts?error=' + encodeURIComponent(`${ALERT_KINDS[kind].label}: 보낼 시각을 정해 주세요.`))
    }
    return {
      kind,
      enabled: formData.get(`enabled_${kind}`) === 'on',
      send_time: time,
      updated_by: me.id,
      updated_at: now,
    }
  })
  const { error } = await admin.from('alert_settings').upsert(rows, { onConflict: 'kind' })
  if (error) redirect('/admin/alerts?error=' + encodeURIComponent('저장하지 못했습니다: ' + error.message))

  // 오늘 이미 보낸 알림의 시각을 지금보다 뒤로 바꿨다면, 오늘 그 시각에 다시 보내도록
  if (formData.get('resend_today') === 'on') {
    await admin.from('alert_runs').delete().eq('run_date', todayKST())
  }
  revalidatePath('/admin/alerts')
  redirect('/admin/alerts?ok=' + encodeURIComponent('알림 설정을 저장했습니다.'))
}
