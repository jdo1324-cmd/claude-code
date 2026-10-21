'use client'

import { useEffect } from 'react'

// 화면이 열리면 알림창(팝업)을 한 번 띄움
export function AlertOnLoad({ message }: { message: string }) {
  useEffect(() => {
    window.alert(message)
  }, [message])
  return null
}
