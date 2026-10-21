import { ConfirmButton } from '@/app/components/confirm-button'
import { CopyButton } from '@/app/components/copy-button'
import { requireOwner } from '@/lib/auth'
import { appsScriptSource, getSheetSettings } from '@/lib/google-sheet'
import { regenerateSecret, saveWebhookUrl, testSheet } from './actions'

export const maxDuration = 120

export default async function GoogleSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  await requireOwner()
  const settings = await getSheetSettings()
  const script = appsScriptSource(settings.secret)
  const connected = !!settings.webhook_url

  return (
    <main>
      <div className="page-head">
        <h1>구글 시트 연결</h1>
        <span className={connected ? 'badge badge-ok' : 'badge'}>{connected ? '연결됨' : '연결 안 됨'}</span>
      </div>
      <p className="small muted">
        연결하면 [전표 확인] 화면에서 확정한 전표를 버튼 한 번으로 사장님의 구글 시트로 보낼 수 있습니다. 시트에는
        &quot;전표&quot; 탭(전표 1건당 1줄)과 &quot;품목&quot; 탭(품목 1개당 1줄)이 자동으로 생기고, 사진은 사장님 구글
        드라이브의 &quot;매장관리 전표 사진&quot; 폴더에 저장됩니다.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <section>
        <h2>처음 한 번만 하면 됩니다 (PC에서 하는 것을 추천)</h2>
        <ol className="steps">
          <li>
            <a href="https://sheets.new" target="_blank" rel="noreferrer">
              sheets.new
            </a>
            를 열어 새 구글 시트를 만들고, 이름을 정합니다. (예: 매장 전표)
          </li>
          <li>
            시트 위쪽 메뉴에서 <strong>확장 프로그램 → Apps Script</strong>를 누릅니다.
          </li>
          <li>
            열린 화면의 코드(<code>function myFunction() …</code>)를 <strong>모두 지우고</strong>, 아래 [코드
            복사하기]로 복사한 코드를 붙여 넣은 뒤 💾 저장합니다.
          </li>
          <li>
            오른쪽 위 <strong>배포 → 새 배포</strong>를 누르고, ⚙️에서 유형을 <strong>웹 앱</strong>으로 고릅니다.
            <ul>
              <li>
                실행 계정: <strong>나</strong>
              </li>
              <li>
                액세스 권한이 있는 사용자: <strong>모든 사용자</strong>
              </li>
            </ul>
          </li>
          <li>
            <strong>배포</strong>를 누르면 구글 계정 권한을 묻습니다. 사장님 계정을 고르고 허용합니다. (&quot;확인되지
            않은 앱&quot; 화면이 나오면 <strong>고급 → (안전하지 않음)으로 이동</strong>을 누르면 됩니다. 사장님이 직접
            만든 코드라서 나오는 안내입니다.)
          </li>
          <li>
            마지막에 나오는 <strong>웹 앱 URL</strong>(https://script.google.com/macros/s/…/exec)을 복사해서 아래 칸에
            붙여 넣고 [저장하고 연결 확인]을 누릅니다.
          </li>
        </ol>

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <h3 style={{ margin: 0 }}>붙여 넣을 코드</h3>
          <CopyButton text={script} label="코드 복사하기" />
        </div>
        <details>
          <summary className="small">코드 내용 보기</summary>
          <pre className="code-block">{script}</pre>
        </details>
        <p className="small text-warn">⚠️ 이 코드에는 비밀값이 들어 있습니다. 다른 사람에게 보내지 마세요.</p>
      </section>

      <section>
        <h2>웹 앱 URL</h2>
        <form action={saveWebhookUrl} className="stack">
          <input
            name="webhook_url"
            type="url"
            required
            defaultValue={settings.webhook_url ?? ''}
            placeholder="https://script.google.com/macros/s/…/exec"
            style={{ width: '100%' }}
          />
          <div className="row">
            <button type="submit">저장하고 연결 확인</button>
          </div>
        </form>
        {connected && (
          <form action={testSheet} style={{ marginTop: 8 }}>
            <button type="submit" className="btn-secondary">
              연결 다시 확인
            </button>
          </form>
        )}
      </section>

      <details className="card">
        <summary>문제가 생겼을 때</summary>
        <ul className="small">
          <li>
            Apps Script 코드를 고치거나 다시 붙여 넣었다면 <strong>배포 → 배포 관리 → ✏️ → 버전: 새 버전 → 배포</strong>
            를 해야 반영됩니다.
          </li>
          <li>
            &quot;비밀값이 맞지 않습니다&quot;가 나오면 위의 코드를 다시 복사해서 붙여 넣고 새 버전으로 배포하세요.
          </li>
          <li>코드가 다른 사람에게 보내졌다면 아래 버튼으로 비밀값을 바꾸고, 코드를 다시 붙여 넣으세요.</li>
        </ul>
        <form action={regenerateSecret}>
          <ConfirmButton message="비밀값을 바꾸면 Apps Script에 새 코드를 붙여 넣고 다시 배포할 때까지 전표를 보낼 수 없습니다. 바꿀까요?">
            비밀값 새로 만들기
          </ConfirmButton>
        </form>
      </details>
    </main>
  )
}
