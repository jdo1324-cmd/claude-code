import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// 비밀번호 재설정 메일의 링크가 도착하는 곳. 로그인 처리 후 비밀번호 변경 화면으로.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as EmailOtpType | null
  const code = params.get('code')
  const nextParam = params.get('next') ?? '/account'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/account'

  const supabase = await createClient()
  let ok = false

  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error
  }

  if (!ok) {
    const url = new URL('/login', request.url)
    url.searchParams.set('error', '링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기를 다시 해 주세요.')
    return NextResponse.redirect(url)
  }

  const url = new URL(next, request.url)
  url.searchParams.set('reset', '1')
  return NextResponse.redirect(url)
}
