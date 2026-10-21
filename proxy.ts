import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

// 모든 페이지 요청마다 세션 갱신 + 비로그인 사용자는 /login 으로
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // 알림용 서비스 워커·앱 정보·아이콘은 로그인 없이 받을 수 있어야 함
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
