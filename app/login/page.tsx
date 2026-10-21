import Link from 'next/link'
import { login } from './actions'
import { LoginButton } from './login-button'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams

  return (
    <main>
      <h1>매장 운영 관리 로그인</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <form action={login}>
        <input type="hidden" name="next" value={next ?? '/'} />
        <p>
          <label>
            이메일
            <br />
            <input name="email" type="email" required autoComplete="email" autoFocus enterKeyHint="next" />
          </label>
        </p>
        <p>
          <label>
            비밀번호
            <br />
            <input name="password" type="password" required autoComplete="current-password" enterKeyHint="go" />
          </label>
        </p>
        {/* 비밀번호 칸에서 엔터를 누르면 이 버튼이 눌린 것과 같음 */}
        <LoginButton />
      </form>
      <p>
        <Link href="/forgot-password">비밀번호를 잊으셨나요?</Link>
      </p>
      <p>계정은 사장님이 직원별로 만들어 드립니다.</p>
    </main>
  )
}
