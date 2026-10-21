import { changePassword } from './actions'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; reset?: string }>
}) {
  const { error, ok, reset } = await searchParams

  return (
    <main>
      <h1>내 비밀번호 변경</h1>
      {reset ? (
        <p className="alert alert-ok">메일 인증이 완료되었습니다. 새 비밀번호를 정해 주세요.</p>
      ) : (
        <p>
          지금 로그인한 본인의 비밀번호를 바꿉니다. 사장님이 만들어 준 임시 비밀번호는 처음 로그인한 뒤 바로 바꿔
          주세요.
        </p>
      )}
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">비밀번호가 변경되었습니다.</p>}
      <form action={changePassword} className="card" style={{ maxWidth: 420 }}>
        <p>
          <label style={{ display: 'block' }}>
            새 비밀번호 (8자 이상)
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
        </p>
        <p>
          <label style={{ display: 'block' }}>
            새 비밀번호 확인
            <input
              name="confirm"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
        </p>
        <button type="submit">변경</button>
      </form>
    </main>
  )
}
