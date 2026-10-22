'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { clockNfc } from '../actions'

// 태그를 찍어 막 열린 화면이면 버튼을 누르지 않아도 바로 출근/퇴근 처리.
// 뒤로 가기 · 새로고침 · 오래 열려 있던 화면에서는 자동으로 처리하지 않고 버튼만 보여 줌.
const FRESH_MS = 120_000

// 태그를 찍으면 브라우저가 이 주소를 새로 엶. 그 첫 화면에서만 자동 처리하고,
// 앱 안에서 다시 들어온 경우(뒤로 가기 등)는 같은 페이지 안이라 이 값이 이미 true.
let usedThisPageLoad = false

function isFreshTagOpen(renderedAt: number) {
  if (usedThisPageLoad) return false
  usedThisPageLoad = true
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (nav && nav.type !== 'navigate') return false
  return Date.now() - renderedAt < FRESH_MS
}

function Status({
  working,
  countdown,
  onCancel,
}: {
  working: boolean
  countdown: number | null
  onCancel: () => void
}) {
  const { pending } = useFormStatus()
  if (pending) return <p className="auto-clock-status">{working ? '퇴근' : '출근'} 처리 중…</p>
  if (countdown === null) return null
  return (
    <div className="auto-clock-status">
      <p>
        <strong>{countdown}초 뒤 퇴근</strong> 처리됩니다.
      </p>
      <button type="button" className="btn-secondary btn-lg" onClick={onCancel}>
        취소 (아직 근무 중)
      </button>
    </div>
  )
}

function ManualButton({ working }: { working: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={working ? 'clock-button out' : 'clock-button'}>
      {pending ? '처리 중…' : working ? '퇴근' : '출근'}
    </button>
  )
}

export function AutoClock({
  token,
  working,
  renderedAt,
  outDelaySeconds = 10,
}: {
  token: string
  working: boolean
  renderedAt: number
  outDelaySeconds?: number
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [mode, setMode] = useState<'checking' | 'auto' | 'manual'>('checking')
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    if (!isFreshTagOpen(renderedAt)) {
      setMode('manual')
      return
    }
    setMode('auto')
    // 출근은 바로, 퇴근은 실수로 스친 경우를 위해 몇 초 기다렸다가
    if (!working) {
      formRef.current?.requestSubmit()
      return
    }
    let left = outDelaySeconds
    setCountdown(left)
    const timer = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearInterval(timer)
        setCountdown(null)
        formRef.current?.requestSubmit()
      } else {
        setCountdown(left)
      }
    }, 1000)
    timerRef.current = timer
    return () => clearInterval(timer)
  }, [renderedAt, working, outDelaySeconds])

  return (
    <form action={clockNfc} ref={formRef}>
      <input type="hidden" name="t" value={token} />
      <input type="hidden" name="action" value={working ? 'out' : 'in'} />
      {mode === 'auto' ? (
        <Status
          working={working}
          countdown={countdown}
          onCancel={() => {
            if (timerRef.current) clearInterval(timerRef.current)
            setCountdown(null)
            setMode('manual')
          }}
        />
      ) : (
        mode === 'manual' && <ManualButton working={working} />
      )}
    </form>
  )
}
