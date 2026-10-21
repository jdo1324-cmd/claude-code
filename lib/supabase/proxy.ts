import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// /api/cron 은 자체 비밀값으로 확인
const PUBLIC_PATHS = ['/login', '/auth', '/forgot-password', '/api/cron']

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // getClaims: 로그인 토큰을 서버에서 바로 검증 (만료됐으면 갱신). Supabase에 매번 묻지 않아 빠름
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims ?? null

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))

  if (!user && !isPublic) {
    // 로그인 후 원래 가려던 곳으로 (예: NFC 태그 주소)
    const next = path + request.nextUrl.search
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = next === '/' ? '' : '?next=' + encodeURIComponent(next)
    return NextResponse.redirect(url)
  }

  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}
