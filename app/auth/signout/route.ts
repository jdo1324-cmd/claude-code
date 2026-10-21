import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function signOut(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const url = new URL('/login', request.url)
  if (request.nextUrl.searchParams.get('reason') === 'inactive') {
    url.searchParams.set('error', '사용이 중지된 계정입니다. 사장님께 문의하세요.')
  }
  return NextResponse.redirect(url, { status: 303 })
}

// 로그아웃 버튼
export const POST = signOut
// 비활성 계정 강제 로그아웃 (lib/auth.ts)
export const GET = signOut
