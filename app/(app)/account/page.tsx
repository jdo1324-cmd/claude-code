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
        <p style={{ color: 'green' }}>메일 인증이 완료되었습니다. 새 비밀번호를 정해 주세요.</p>
      ) : (
        <p>
          지금 로그인한 본인의 비밀번호를 바꿉니다. 사장님이 만들어 준 임시 비밀번호는 처음 로그인한 뒤 바로 바꿔
          주세요.
        </p>
      )}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {ok && <p style={{ color: 'green' }}>비밀번호가 변경되었습니다.</p>}
      <form action={changePassword}>
        <p>
          <label>
            새 비밀번호 (8자 이상)
            <br />
            <input name="password" type="password" minLength={8} required autoComplete="new-password" />
          </label>
        </p>
        <p>
          <label>
            새 비밀번호 확인
            <br />
            <input name="confirm" type="password" minLength={8} required autoComplete="new-password" />
          </label>
        </p>
        <button type="submit">변경</button>
      </form>
    </main>
  )
}
