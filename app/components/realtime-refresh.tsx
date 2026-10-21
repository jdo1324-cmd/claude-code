'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// 다른 직원이 체크하면(DB 변경) 이 화면을 바로 다시 불러옴 (Supabase Realtime)
export function RealtimeRefresh({ table, filter }: { table: string; filter?: string }) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) supabase.realtime.setAuth(data.session.access_token)
      channel = supabase
        .channel(`refresh-${table}-${filter ?? 'all'}`)
        .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => router.refresh())
        .subscribe()
    })

    // 휴대폰 화면을 껐다 켜면(다시 보면) 최신 상태로
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) supabase.removeChannel(channel)
    }
  }, [router, table, filter])

  return null
}
