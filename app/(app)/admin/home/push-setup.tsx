'use client'

import { useEffect, useState } from 'react'
import { getPushPublicKey, removePushSubscription, savePushSubscription, sendTestPush } from './push-actions'

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

type State = 'checking' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'

export function PushSetup() {
  const [state, setState] = useState<State>('checking')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState(isIos && !standalone ? 'ios-install' : 'unsupported')
        return
      }
      if (Notification.permission === 'denied') return setState('denied')
      const reg = await navigator.serviceWorker.register('/sw.js')
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
    })().catch(() => setState('unsupported'))
  }, [])

  async function turnOn() {
    setBusy(true)
    setMessage(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const key = await getPushPublicKey()
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
      const result = await savePushSubscription(JSON.parse(JSON.stringify(sub)), navigator.userAgent)
      if (result.error) throw new Error(result.error)
      setState('on')
      setMessage('이 휴대폰으로 알림을 받습니다. [시험 알림]으로 확인해 보세요.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '알림을 켜지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await removePushSubscription(sub.endpoint)
      await sub.unsubscribe()
    }
    setState('off')
    setBusy(false)
  }

  async function test() {
    setBusy(true)
    const { sent } = await sendTestPush()
    setMessage(sent > 0 ? '시험 알림을 보냈습니다. 몇 초 안에 도착합니다.' : '보낼 기기가 없습니다. 알림을 다시 켜 주세요.')
    setBusy(false)
  }

  return (
    <div style={{ border: '1px solid #2a6f4f', padding: 10 }}>
      <strong>📱 휴대폰 알림</strong>{' '}
      {state === 'checking' && '확인 중…'}
      {state === 'on' && (
        <>
          켜짐 <button onClick={test} disabled={busy}>시험 알림</button> <button onClick={turnOff} disabled={busy}>끄기</button>
        </>
      )}
      {state === 'off' && (
        <button onClick={turnOn} disabled={busy} style={{ fontWeight: 'bold' }}>
          이 휴대폰으로 알림 받기
        </button>
      )}
      {state === 'denied' && '알림이 차단되어 있습니다. 휴대폰 설정 → 브라우저(또는 이 앱) → 알림을 허용해 주세요.'}
      {state === 'ios-install' && (
        <div>
          아이폰은 먼저 <strong>Safari 공유 버튼 → &quot;홈 화면에 추가&quot;</strong>를 한 뒤, 홈 화면의 &quot;매장관리&quot; 앱으로 열어서 이
          버튼을 눌러야 알림을 받을 수 있습니다 (iOS 16.4 이상).
        </div>
      )}
      {state === 'unsupported' && '이 브라우저는 알림을 지원하지 않습니다. 휴대폰의 크롬(안드로이드) 또는 홈 화면 앱(아이폰)으로 열어 주세요.'}
      {message && <div style={{ color: '#2a6f4f' }}>{message}</div>}
      <div style={{ fontSize: 12, color: '#666' }}>
        알림: 정정 요청 · 전표 확인 대기 · 매출 보고서 제출(금액 차이) · 매일 밤 22시 놓친 업무 점검
      </div>
    </div>
  )
}
