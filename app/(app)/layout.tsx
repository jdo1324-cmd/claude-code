import Link from 'next/link'
import { getCurrentProfile, isAdmin } from '@/lib/auth'
import { EMPLOYMENT_LABEL, ROLE_LABEL } from '@/lib/format'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentProfile()

  return (
    <>
      <header style={{ borderBottom: '1px solid #ccc', paddingBottom: 8, marginBottom: 16 }}>
        <strong>{me.full_name}</strong> ({ROLE_LABEL[me.role]} · {EMPLOYMENT_LABEL[me.employment_type]})
        <nav style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin(me.role) && (
            <Link href="/admin/home">
              <strong>{me.role === 'owner' ? '사장 홈' : '관리자 홈'}</strong>
            </Link>
          )}
          <Link href="/">출퇴근</Link>
          <Link href="/checklist">체크리스트</Link>
          <Link href="/sales">매출 정산</Link>
          <Link href="/receipts">전표 올리기</Link>
          <Link href="/corrections">정정 요청</Link>
          {isAdmin(me.role) && <Link href="/admin">관리</Link>}
          {isAdmin(me.role) && <Link href="/admin/checklists">체크리스트 기록</Link>}
          {isAdmin(me.role) && <Link href="/admin/receipts">전표 확인</Link>}
          {isAdmin(me.role) && <Link href="/admin/hours">월별 근무시간</Link>}
          {me.role === 'owner' && <Link href="/admin/sales">월 매출</Link>}
          {me.role === 'owner' && <Link href="/admin/pay">급여</Link>}
          <Link href="/account">내 비밀번호 변경</Link>
          <form action="/auth/signout" method="post">
            <button type="submit">로그아웃</button>
          </form>
        </nav>
      </header>
      {children}
    </>
  )
}
