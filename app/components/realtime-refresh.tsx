'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// 다른 직원이 체크하면(DB 변경) 이 화면을 다시 불러옴 (Supabase Realtime)
// - Supabase 클라이언트(큰 파일)는 화면이 다 뜬 뒤에 따로 불러옴
// - 짧은 시간에 여러 건이 바뀌면 1.5초 모아서 한 번만 새로고침
// - 휴대폰 화면을 다시 켰을 때는 30초 이상 지났을 때만 새로고침
export function RealtimeRefresh({ table, filter }: { table: string; filter?: string }) {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let hiddenAt = 0
    let cleanup = () => {}

    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), 1500)
    }

    import('@/lib/supabase/client').then(async ({ createClient }) => {
      if (cancelled) return
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) supabase.realtime.setAuth(data.session.access_token)
      const channel = supabase
        .channel(`refresh-${table}-${filter ?? 'all'}`)
        .on('postgres_changes', { event: '*', schema: 'public', table, filter }, refresh)
        .subscribe()
      cleanup = () => {
        supabase.removeChannel(channel)
      }
    })

    const onVisible = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > 30_000) router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      cleanup()
    }
  }, [router, table, filter])

  return null
}
