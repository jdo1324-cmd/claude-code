'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { clockByNfc } from '@/lib/clock'
import { createClient } from '@/lib/supabase/server'

// 같은 사이트 안의 경로만 허용
function safePath(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value ?? '')
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : fallback
}

function withParam(path: string, key: string, value: string) {
  return path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(value)
}

// NFC 화면의 [출근] / [퇴근] 버튼
export async function clockNfc(formData: FormData) {
  const me = await getCurrentProfile()
  const token = String(formData.get('t') ?? '')
  const action = formData.get('action') === 'out' ? 'out' : 'in'
  const result = await clockByNfc(me.id, token, action)

  revalidatePath('/')
  revalidatePath('/admin')
  if (result.needBreak) {
    // 휴게시간을 안 적은 아르바이트: 퇴근 처리 안 하고 NFC 화면으로 돌아가 알림
    redirect(`/nfc?t=${encodeURIComponent(token)}&need_break=1`)
  }
  if (result.error) redirect('/?error=' + encodeURIComponent(result.error))
  redirect('/?ok=' + encodeURIComponent(action === 'in' ? '출근 처리되었습니다.' : '퇴근 처리되었습니다.'))
}

// 아르바이트 본인의 휴게시간 입력 (1회, 이후 수정 불가)
export async function submitBreak(formData: FormData) {
  await getCurrentProfile()
  const back = safePath(formData.get('back'), '/')
  const attendanceId = Number(formData.get('attendance_id'))
  const raw = String(formData.get('minutes') ?? '')

  if (raw === '') redirect(withParam(back, 'error', '휴게시간을 선택하세요.'))

  const supabase = await createClient()
  const { error } = await supabase.rpc('submit_break', { p_attendance_id: attendanceId, p_minutes: Number(raw) })

  revalidatePath('/')
  revalidatePath('/admin')
  if (error) redirect(withParam(back, 'error', error.message))
  redirect(withParam(back, 'ok', '휴게시간을 저장했습니다.'))
}
