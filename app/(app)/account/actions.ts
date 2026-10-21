'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function changePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < 8) redirect('/account?error=' + encodeURIComponent('8자 이상 입력하세요.'))
  if (password !== confirm) redirect('/account?error=' + encodeURIComponent('두 비밀번호가 다릅니다.'))

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) redirect('/account?error=' + encodeURIComponent(error.message))

  redirect('/account?ok=1')
}
