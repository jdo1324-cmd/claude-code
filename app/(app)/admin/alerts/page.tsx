import Link from 'next/link'
import { ALERT_KINDS, WEB_PUSH_CHANNEL, getAlertSettings, isKindVisible, type AlertKind } from '@/lib/alert-settings'
import { requireOwner } from '@/lib/auth'
import { todayKST } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'
import { saveAlertSettings } from './actions'

export default async function AlertSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const { ok, error } = await searchParams
  await requireOwner()
  const [settings, { data: runData }] = await Promise.all([
    getAlertSettings(),
    createAdminClient().from('alert_runs').select('kind, ran_at').eq('run_date', todayKST()),
  ])
  const byKind = new Map(settings.map((s) => [s.kind, s]))
  const ranToday = new Map(((runData ?? []) as { kind: string; ran_at: string }[]).map((r) => [r.kind, r.ran_at]))
  const kinds = (Object.keys(ALERT_KINDS) as AlertKind[]).filter(isKindVisible)
  const webPush = byKind.get(WEB_PUSH_CHANNEL)?.enabled ?? false
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))

  return (
    <main>
      <h1>알림 설정</h1>
      <p className="small muted">
        사장님·관리자에게 가는 알림을 종류별로 켜고 끄고, 정해진 시각에 보내는 알림은 시각을 정합니다. 시각은 5분 단위로
        확인하므로 최대 5분 늦게 올 수 있습니다.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <form action={saveAlertSettings}>
        <section className="card">
          <h2>알림 받는 방법</h2>
          <div className="alert-row">
            <label className="check-label">
              <input type="checkbox" name="web_push" defaultChecked={webPush} /> <strong>휴대폰 웹 알림</strong>{' '}
              <span className={webPush ? 'badge badge-ok' : 'badge'}>{webPush ? '켜짐' : '꺼짐'}</span>
            </label>
            <p className="small muted" style={{ margin: 0 }}>
              브라우저 알림(사장 홈의 &quot;이 휴대폰으로 알림 받기&quot;)으로 보낼지. 끄면 잔디로만 갑니다.
            </p>
          </div>
          <div className="alert-row">
            <strong>잔디 1:1 메시지</strong>
            <p className="small muted" style={{ margin: 0 }}>
              <Link href="/admin/jandi">잔디 알림 연결</Link>에서 받을 사람을 정합니다.
            </p>
          </div>
        </section>

        <section className="card">
          <h2>정해진 시각에 보내는 알림</h2>
          {kinds
            .filter((k) => ALERT_KINDS[k].scheduled)
            .map((k) => {
              const s = byKind.get(k)
              return (
                <div key={k} className="alert-row">
                  <label className="check-label">
                    <input type="checkbox" name={`enabled_${k}`} defaultChecked={s?.enabled ?? true} />{' '}
                    <strong>{ALERT_KINDS[k].label}</strong>
                  </label>
                  <div className="row">
                    매일
                    <input
                      type="time"
                      name={`time_${k}`}
                      step={300}
                      required
                      defaultValue={s?.send_time?.slice(0, 5) ?? '20:00'}
                    />
                    {ranToday.has(k) && <span className="badge badge-ok">오늘 {fmt(ranToday.get(k)!)} 보냄</span>}
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>
                    {ALERT_KINDS[k].description}
                  </p>
                </div>
              )
            })}
          <label className="check-label small" style={{ marginTop: 8, display: 'block' }}>
            <input type="checkbox" name="resend_today" /> 오늘 이미 보낸 알림도 새 시각에 한 번 더 보내기
          </label>
        </section>

        <section className="card">
          <h2>일이 생기면 바로 보내는 알림</h2>
          {kinds
            .filter((k) => !ALERT_KINDS[k].scheduled)
            .map((k) => (
              <div key={k} className="alert-row">
                <label className="check-label">
                  <input type="checkbox" name={`enabled_${k}`} defaultChecked={byKind.get(k)?.enabled ?? true} />{' '}
                  <strong>{ALERT_KINDS[k].label}</strong>
                </label>
                <p className="small muted" style={{ margin: 0 }}>
                  {ALERT_KINDS[k].description}
                </p>
              </div>
            ))}
        </section>

        <button type="submit" className="btn-lg">
          저장
        </button>
      </form>
    </main>
  )
}
