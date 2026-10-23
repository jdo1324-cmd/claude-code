import { ConfirmButton } from '@/app/components/confirm-button'
import { CopyButton } from '@/app/components/copy-button'
import { requireOwner } from '@/lib/auth'
import { appsScriptSource, getSheetSettings } from '@/lib/google-sheet'
import { refreshLedger, regenerateSecret, saveWebhookUrl, testSheet } from './actions'

export const maxDuration = 120

export default async function GoogleSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  await requireOwner()
  const settings = await getSheetSettings()
  const script = appsScriptSource(settings.secret, settings.ledger_file_id)
  const connected = !!settings.webhook_url

  return (
    <main>
      <div className="page-head">
        <h1>구글 시트 연결</h1>
        <span className={connected ? 'badge badge-ok' : 'badge'}>{connected ? '연결됨' : '연결 안 됨'}</span>
      </div>
      <p className="small muted">
        손익계산서에 코드 하나를 붙여 넣으면 세 가지가 시트로 갑니다. ① 확정한 전표 →{' '}
        <strong>매장 매출 매입 장부</strong> 파일의 &quot;YY년M월&quot; 탭(품목 줄 × 전표 날짜 칸에 금액을 더함)과
        &quot;평균단가&quot; 탭 (사진은 보내지 않음). ② [월별 근무시간]의 출퇴근 기록 → 손익계산서 &quot;N월
        인건비&quot; 탭의 날짜 칸. ③ [일용직] 기록 → 같은 탭의 일용직 구역.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <section>
        <h2>처음 한 번만 하면 됩니다 (PC에서 하는 것을 추천)</h2>
        <ol className="steps">
          <li>
            구글 드라이브에서 <strong>손익계산서</strong> 시트를 엽니다. (&quot;9월 인건비&quot;, &quot;X월 인건비&quot;
            탭이 있는 그 파일)
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
            위쪽 함수 고르는 칸에서 <strong>checkLedgerAccess</strong>를 고르고 <strong>▶ 실행</strong>을 누릅니다.
            권한을 물으면 허용합니다. (매장 매출 매입 장부 파일에 쓰려면 한 번 필요합니다)
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

      <section>
        <h2>매출 매입 장부 (전표)</h2>
        <p className="small muted">
          전표를 확정하면{' '}
          {settings.ledger_file_id ? (
            <a
              href={`https://docs.google.com/spreadsheets/d/${settings.ledger_file_id}/edit`}
              target="_blank"
              rel="noreferrer"
            >
              매장 매출 매입 장부
            </a>
          ) : (
            '매장 매출 매입 장부'
          )}
          에 적힙니다. 장부에 품목 줄을 새로 만들거나 이름을 바꿨다면, 아래 버튼으로 전표 확인 화면의 &quot;장부
          품목&quot; 목록을 새로 고치세요.
        </p>
        {connected && (
          <form action={refreshLedger}>
            <button type="submit" className="btn-secondary">
              장부 품목 다시 불러오기
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
