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
  const [showHelp, setShowHelp] = useState(false)
  const [isWhale, setIsWhale] = useState(false)

  useEffect(() => {
    ;(async () => {
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
      setIsWhale(/Whale\//.test(navigator.userAgent))
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
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
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
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
    setMessage(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (!sub) {
        setState('off')
        setMessage('이 휴대폰의 알림 등록이 없습니다. [이 휴대폰으로 알림 받기]를 다시 눌러 주세요.')
        return
      }
      const result = await sendTestPush(sub.endpoint)
      setMessage(result.message)
      setShowHelp(true)
    } finally {
      setBusy(false)
    }
  }

  // 서버를 거치지 않고 이 휴대폰에서 바로 알림을 띄워 봄 → 안 뜨면 휴대폰 설정 문제
  async function localTest() {
    setMessage(null)
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('화면 알림 시험', {
        body: '이 알림이 보이면 휴대폰 알림 설정은 정상입니다.',
        icon: '/icon',
      })
      setMessage('휴대폰에 바로 알림을 띄웠습니다. 안 보이면 휴대폰 설정에서 이 브라우저의 알림이 꺼져 있는 것입니다.')
    } catch {
      setMessage('이 브라우저에서는 알림을 띄울 수 없습니다. 크롬으로 열어 주세요.')
    }
    setShowHelp(true)
  }

  return (
    <div className="card">
      <strong>📱 휴대폰 알림</strong> {state === 'checking' && '확인 중…'}
      {state === 'on' && (
        <>
          켜짐{' '}
          <button onClick={test} disabled={busy}>
            시험 알림
          </button>{' '}
          <button onClick={localTest} disabled={busy} className="btn-secondary">
            바로 띄워 보기
          </button>{' '}
          <button onClick={turnOff} disabled={busy}>
            끄기
          </button>
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
          아이폰은 먼저 <strong>Safari 공유 버튼 → &quot;홈 화면에 추가&quot;</strong>를 한 뒤, 홈 화면의
          &quot;매장관리&quot; 앱으로 열어서 이 버튼을 눌러야 알림을 받을 수 있습니다 (iOS 16.4 이상).
        </div>
      )}
      {state === 'unsupported' &&
        '이 브라우저는 알림을 지원하지 않습니다. 휴대폰의 크롬(안드로이드) 또는 홈 화면 앱(아이폰)으로 열어 주세요.'}
      {message && <div style={{ color: 'var(--success)', marginTop: 6 }}>{message}</div>}
      {isWhale && (
        <p className="alert alert-warn small">
          지금 <strong>네이버 웨일</strong>로 열려 있습니다. 웨일은 안드로이드에서 알림이 오지 않는 경우가 많습니다.{' '}
          <strong>크롬</strong>으로 이 주소를 열어 [이 휴대폰으로 알림 받기]를 다시 눌러 주세요.
        </p>
      )}
      {showHelp && (
        <details className="small" open>
          <summary>알림이 안 뜰 때</summary>
          <ol style={{ margin: '4px 0' }}>
            <li>
              [바로 띄워 보기]도 안 뜨면: 휴대폰 설정 → 애플리케이션 → (크롬/웨일) → 알림 → 허용, 방해 금지 모드 해제
            </li>
            <li>
              [바로 띄워 보기]는 뜨는데 [시험 알림]만 안 뜨면: 브라우저가 알림을 못 받는 것입니다. 크롬으로 열어 다시
              등록하세요.
            </li>
            <li>절전 모드/배터리 최적화에서 브라우저를 &quot;제한 없음&quot;으로 두면 더 잘 옵니다.</li>
          </ol>
        </details>
      )}
      <div className="small muted">
        알림: 정정 요청 · 전표 확인 대기 · 매출 보고서 제출(금액 차이) · 매일 밤 22시 놓친 업무 점검
      </div>
    </div>
  )
}
