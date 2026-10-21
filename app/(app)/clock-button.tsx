'use client'

import { useFormStatus } from 'react-dom'

export function ClockButton({ working }: { working: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button type="submit" disabled={pending} className={working ? 'clock-button out' : 'clock-button'}>
      {pending ? '처리 중…' : working ? '퇴근' : '출근'}
    </button>
  )
}
