'use client'

import { useFormStatus } from 'react-dom'

// 엔터 키나 버튼으로 제출하면 "로그인 중…"으로 바뀌고, 처리 중에는 다시 누를 수 없음
export function LoginButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}>
      {pending ? '로그인 중…' : '로그인'}
    </button>
  )
}
