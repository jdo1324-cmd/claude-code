'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function sendResetEmail(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/account`,
  })

  // 너무 자주 요청한 경우만 알려주고, 없는 이메일인지는 알려주지 않음
  if (error?.status === 429) {
    redirect('/forgot-password?error=' + encodeURIComponent('요청이 너무 많습니다. 잠시 후 다시 시도하세요.'))
  }
  redirect('/forgot-password?sent=1')
}
