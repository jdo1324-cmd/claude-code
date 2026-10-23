import { ConfirmButton } from '@/app/components/confirm-button'
import { requireOwner, type Profile } from '@/lib/auth'
import { ROLE_LABEL } from '@/lib/format'
import { getJandiWebhook, isTeamWebhook } from '@/lib/jandi'
import { createAdminClient } from '@/lib/supabase/admin'
import { saveJandiRecipients, saveJandiWebhook, testJandi } from './actions'

export default async function JandiPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams
  await requireOwner()
  const admin = createAdminClient()
  const [webhookUrl, { data: profileData }, { data: recipientData }] = await Promise.all([
    getJandiWebhook(),
    admin.from('profiles').select('*').in('role', ['owner', 'manager']).eq('is_active', true).order('created_at'),
    admin.from('jandi_recipients').select('user_id, email, enabled'),
  ])
  const people = (profileData ?? []) as Profile[]
  const recipients = new Map(
    ((recipientData ?? []) as { user_id: string; email: string; enabled: boolean }[]).map((r) => [r.user_id, r]),
  )
  const team = webhookUrl ? isTeamWebhook(webhookUrl) : false

  return (
    <main>
      <div className="page-head">
        <h1>잔디 알림 연결</h1>
        <span className={webhookUrl ? 'badge badge-ok' : 'badge'}>{webhookUrl ? '연결됨' : '연결 안 됨'}</span>
      </div>
      <p className="small muted">
        사장님·관리자에게 가는 알림(정정 요청, 전표 확인 대기, 매출 보고서, 20:30 체크리스트 미완료, 22:00 놓친 일
        점검)을 잔디 1:1 메시지로도 보냅니다. 휴대폰 웹 알림과 함께 갑니다.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <section>
        <h2>1. 잔디 팀 웹훅 주소</h2>
        <ol className="steps small">
          <li>
            잔디 <strong>PC 앱 또는 웹</strong>에서 팀 관리자(소유자) 계정으로{' '}
            <strong>관리자 메뉴 → 잔디 커넥트(연동)</strong>로 들어갑니다.
          </li>
          <li>
            <strong>팀 인커밍 웹훅 (Team Incoming Webhook)</strong>을 추가하고, 발급된 주소(
            <code>https://wh.jandi.com/connect-api/team-webhook/…</code>)를 복사합니다.
          </li>
          <li>아래 칸에 붙여 넣고 저장합니다.</li>
        </ol>
        <form action={saveJandiWebhook} className="stack">
          <input
            name="webhook_url"
            type="url"
            required
            defaultValue={webhookUrl ?? ''}
            placeholder="https://wh.jandi.com/connect-api/team-webhook/…"
            style={{ width: '100%' }}
          />
          <div>
            <button type="submit">저장</button>
          </div>
        </form>
        {webhookUrl && !team && (
          <p className="alert alert-warn small">
            지금 주소는 <strong>토픽 웹훅</strong>입니다. 1:1이 아니라 그 토픽에 메시지가 올라갑니다. 1:1로 받으려면 팀
            인커밍 웹훅 주소로 바꿔 주세요.
          </p>
        )}
        <p className="small text-warn">
          ⚠️ 이 주소를 아는 사람은 잔디로 메시지를 보낼 수 있습니다. 다른 사람에게 알려주지 마세요.
        </p>
      </section>

      <section>
        <h2>2. 받을 사람</h2>
        <p className="small muted">
          각자 <strong>잔디에 로그인하는 이메일</strong>을 적어 주세요. 앱 로그인 이메일과 다르면 잔디 쪽 이메일로
          바꿔야 합니다. 비워 두면 그 사람에게는 보내지 않습니다.
        </p>
        <form action={saveJandiRecipients}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>잔디 이메일</th>
                  <th>받기</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const r = recipients.get(p.id)
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.full_name} <span className="small muted">{ROLE_LABEL[p.role]}</span>
                        <input type="hidden" name="user_id" value={p.id} />
                      </td>
                      <td>
                        <input
                          name={`email_${p.id}`}
                          type="email"
                          defaultValue={r?.email ?? p.email}
                          style={{ width: '100%', minWidth: 200 }}
                        />
                      </td>
                      <td>
                        <input type="checkbox" name={`enabled_${p.id}`} defaultChecked={r ? r.enabled : true} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button type="submit">받을 사람 저장</button>
        </form>
      </section>

      <section>
        <h2>3. 시험 보내기</h2>
        <p className="small muted">저장한 &quot;받기&quot; 켠 사람들에게 잔디 1:1 메시지를 보냅니다.</p>
        <form action={testJandi}>
          <ConfirmButton message="잔디로 시험 메시지를 보낼까요?">잔디로 시험 보내기</ConfirmButton>
        </form>
      </section>
    </main>
  )
}
