'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { REQUEST_TYPE_LABEL } from '@/lib/corrections'
import { notifyAdmins } from '@/lib/push'
import { getCurrentProfile } from '@/lib/auth'
import { fromKstInput } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

function back(params: Record<string, string>): never {
  revalidatePath('/corrections')
  revalidatePath('/admin')
  redirect('/corrections?' + new URLSearchParams(params).toString())
}

function optionalMinutes(value: FormDataEntryValue | null) {
  const raw = String(value ?? '')
  return raw === '' ? null : Number(raw)
}

export async function requestCorrection(formData: FormData) {
  await getCurrentProfile()
  const type = String(formData.get('type') ?? '')
  const attendanceId = formData.get('attendance_id') ? Number(formData.get('attendance_id')) : null
  const rawIn = String(formData.get('clock_in') ?? '')
  const rawOut = String(formData.get('clock_out') ?? '')
  const clockIn = rawIn ? fromKstInput(rawIn) : null
  const clockOut = rawOut ? fromKstInput(rawOut) : null
  const keep: Record<string, string> = attendanceId ? { attendance_id: String(attendanceId) } : {}

  if ((rawIn && !clockIn) || (rawOut && !clockOut)) back({ ...keep, error: '시간 형식이 잘못되었습니다.' })

  const supabase = await createClient()
  const { error } = await supabase.rpc('request_correction', {
    p_type: type,
    p_attendance_id: attendanceId,
    p_clock_in: clockIn,
    p_clock_out: clockOut,
    p_break_minutes: optionalMinutes(formData.get('minutes')),
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back({ ...keep, error: error.message })

  const me = await getCurrentProfile()
  after(() =>
    notifyAdmins({
      title: '정정 요청',
      body: `${me.full_name}: ${REQUEST_TYPE_LABEL[type as keyof typeof REQUEST_TYPE_LABEL] ?? type} — ${String(formData.get('reason') ?? '')}`,
      url: '/admin',
    }),
  )
  back({ ok: '정정 요청을 보냈습니다. 사장님이나 관리자가 확인 후 처리합니다.' })
}

export async function cancelCorrection(formData: FormData) {
  await getCurrentProfile()
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_correction', { p_request_id: Number(formData.get('id')) })
  if (error) back({ error: error.message })
  back({ ok: '요청을 취소했습니다.' })
}
