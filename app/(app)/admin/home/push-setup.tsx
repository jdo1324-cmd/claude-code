'use client'

import { useEffect, useState } from 'react'
import {
  getPushPublicKey,
  getPushTest,
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from './push-actions'

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
      // 서비스 워커를 최신으로 (휴대폰이 받았는지 알려 주는 기능 포함)
      await reg?.update().catch(() => {})
      const result = await sendTestPush(sub.endpoint)
      setMessage(result.message)
      setShowHelp(true)
      if (!result.ok || !result.testId) return
      setMessage(result.message + ' 휴대폰이 받는지 기다리는 중…')
      // 최대 20초 동안 휴대폰의 응답을 기다림
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const t = await getPushTest(result.testId)
        if (t?.shown_at) {
          setMessage(
            '✅ 휴대폰이 알림을 받아서 화면에 띄웠습니다. 안 보였다면 휴대폰 알림 설정(소리·팝업·잠금 화면)을 확인해 주세요.',
          )
          return
        }
        if (t?.show_error) {
          setMessage(`⚠️ 휴대폰이 알림을 받았지만 띄우지 못했습니다: ${t.show_error}`)
          return
        }
        if (t?.received_at && i >= 4) {
          setMessage(
            '⚠️ 휴대폰이 알림을 받았지만 화면에 띄우지 못하고 있습니다. 브라우저/사이트 알림 설정을 확인해 주세요.',
          )
          return
        }
      }
      setMessage(
        '❌ 20초 동안 휴대폰에 알림이 도착하지 않았습니다. 브라우저가 잠들어 있어 못 받는 것입니다. 아래 "알림이 안 뜰 때"의 배터리 설정을 바꾸거나 크롬으로 등록해 주세요.',
      )
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
      {showHelp && (
        <details className="small" open>
          <summary>알림이 안 뜰 때 ({isWhale ? '웨일' : '크롬'} 기준)</summary>
          <ol style={{ margin: '4px 0' }}>
            <li>
              <strong>[바로 띄워 보기]도 안 뜨면</strong> → 휴대폰 설정 → 애플리케이션 → {isWhale ? '웨일' : '크롬'} →
              알림 → 전체 허용. 그 안의 <strong>&quot;사이트&quot; / &quot;store-ops-tau.vercel.app&quot;</strong>{' '}
              항목도 켜기.
              {isWhale && ' 웨일 앱 → 설정 → 사이트 설정 → 알림에서 이 사이트가 "허용"인지도 확인.'}
            </li>
            <li>
              <strong>&quot;도착하지 않았습니다&quot;가 나오면</strong> → 휴대폰이 {isWhale ? '웨일' : '크롬'}을 재워서
              못 받는 것입니다. 설정 → 배터리(또는 애플리케이션 → {isWhale ? '웨일' : '크롬'} → 배터리) →{' '}
              <strong>&quot;제한 없음&quot;</strong>. 삼성 휴대폰은 배터리 → 백그라운드 사용 제한 →{' '}
              <strong>&quot;절전 예외 앱&quot;에 추가</strong>, &quot;사용하지 않는 앱 절전&quot;에서 빼기. 데이터 →
              백그라운드 데이터 허용.
            </li>
            <li>
              {isWhale ? '웨일' : '크롬'}을 최신 버전으로 업데이트한 뒤 [끄기] → [이 휴대폰으로 알림 받기]로 다시 등록.
            </li>
            {isWhale && (
              <li>
                위를 다 해도 &quot;도착하지 않았습니다&quot;면 웨일이 알림을 못 받는 것이니 크롬으로 등록해 주세요.
              </li>
            )}
          </ol>
        </details>
      )}
      <div className="small muted">
        알림: 정정 요청 · 전표 확인 대기 · 매출 보고서 · 체크리스트 미완료 · 놓친 일 점검 (시각은 [알림 설정]에서)
      </div>
    </div>
  )
}
