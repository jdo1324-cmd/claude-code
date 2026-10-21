'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// 같은 사이트 안의 경로만 허용 (외부 사이트로 튕기는 것 방지)
function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? '')
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}

export async function login(formData: FormData) {
  const next = safeNext(formData.get('next'))
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  })

  if (error) {
    const params = new URLSearchParams({
      error: '이메일 또는 비밀번호가 올바르지 않거나, 사용이 중지된 계정입니다.',
    })
    if (next !== '/') params.set('next', next)
    redirect('/login?' + params.toString())
  }
  redirect(next)
}
