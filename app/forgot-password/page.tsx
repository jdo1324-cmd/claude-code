import Link from 'next/link'
import { sendResetEmail } from './actions'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const { sent, error } = await searchParams

  return (
    <main>
      <h1>비밀번호 찾기</h1>
      {sent ? (
        <p>
          등록된 이메일이라면 비밀번호 재설정 메일을 보냈습니다. 메일의 링크를 누르면 새 비밀번호를 정할 수 있습니다.
          (스팸함도 확인해 주세요)
        </p>
      ) : (
        <>
          <p>가입한 이메일을 입력하세요. 직원은 사장님께 비밀번호 초기화를 요청해도 됩니다.</p>
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
          <form action={sendResetEmail}>
            <p>
              <input name="email" type="email" required autoComplete="email" />
            </p>
            <button type="submit">재설정 메일 보내기</button>
          </form>
        </>
      )}
      <p>
        <Link href="/login">로그인으로 돌아가기</Link>
      </p>
    </main>
  )
}
