import 'server-only'
import { createClient } from '@supabase/supabase-js'

// 서버 전용 비밀 키 클라이언트 (RLS 우회). 사장 권한 확인 후에만 사용할 것.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
