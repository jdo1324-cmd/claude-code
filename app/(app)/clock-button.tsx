'use client'

import { useFormStatus } from 'react-dom'

export function ClockButton({ working }: { working: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button type="submit" disabled={pending} style={{ fontSize: 24, padding: '16px 48px' }}>
      {pending ? '처리 중…' : working ? '퇴근' : '출근'}
    </button>
  )
}
