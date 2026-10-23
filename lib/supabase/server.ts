import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// 로그인한 사용자 권한으로 동작하는 클라이언트 (RLS 적용)
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Component에서는 쿠키를 쓸 수 없음. 세션 갱신은 proxy.ts가 처리.
        }
      },
    },
  })
}
