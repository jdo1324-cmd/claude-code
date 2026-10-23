import { createBrowserClient } from '@supabase/ssr'

// 브라우저용 클라이언트 (사진 올리기, 실시간 반영). 로그인 쿠키를 그대로 사용 → RLS 적용.
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
}
