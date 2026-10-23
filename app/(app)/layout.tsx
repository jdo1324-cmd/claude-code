import Link from 'next/link'
import { getCurrentProfile, isAdmin } from '@/lib/auth'
import { EMPLOYMENT_LABEL, ROLE_LABEL } from '@/lib/format'
import { AppNav, type NavLink } from './app-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentProfile()
  const admin = isAdmin(me.role)
  const owner = me.role === 'owner'

  // 모든 직원이 쓰는 메뉴 (휴대폰에서는 아래쪽 탭)
  const work: NavLink[] = [
    ...(admin ? [{ href: '/admin/home', label: owner ? '사장 홈' : '관리자 홈', icon: 'home' as const }] : []),
    { href: '/', label: '출퇴근', icon: 'clock' },
    { href: '/checklist', label: '체크리스트', icon: 'check' },
    { href: '/sales', label: '매출 정산', icon: 'won' },
    { href: '/receipts', label: '전표 올리기', icon: 'receipt' },
    { href: '/corrections', label: '정정 요청', icon: 'edit' },
  ]
  // 사장/관리자 메뉴
  const manage: NavLink[] = admin
    ? [
        { href: '/admin', label: '직원·출퇴근 관리' },
        { href: '/admin/checklists', label: '체크리스트 기록' },
        { href: '/admin/receipts', label: '전표 확인' },
        { href: '/admin/hours', label: '월별 근무시간' },
        ...(owner
          ? [
              { href: '/admin/sales', label: '월 매출' },
              { href: '/admin/pay', label: '급여' },
              { href: '/admin/checklist-items', label: '체크리스트 설정' },
              { href: '/admin/google-sheet', label: '구글 시트 연결' },
              { href: '/admin/alerts', label: '알림 설정' },
              { href: '/admin/jandi', label: '잔디 알림 연결' },
            ]
          : []),
      ]
    : []

  return (
    <div className="app-body">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={admin ? '/admin/home' : '/'} className="brand">
            <span className="brand-mark" aria-hidden>
              매
            </span>
            <span>매장 관리</span>
          </Link>
          <div className="who">
            <strong>{me.full_name}</strong>
            <small>
              {ROLE_LABEL[me.role]} · {EMPLOYMENT_LABEL[me.employment_type]}
            </small>
          </div>
          <details className="header-menu">
            <summary aria-label="메뉴 열기">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <div className="menu-panel">
              <AppNav links={work} variant="menu" />
              {manage.length > 0 && (
                <>
                  <div className="menu-sep" />
                  <div className="menu-title">관리</div>
                  <AppNav links={manage} variant="menu" />
                </>
              )}
              <div className="menu-sep" />
              <AppNav links={[{ href: '/account', label: '내 비밀번호 변경' }]} variant="menu" />
              <form action="/auth/signout" method="post">
                <button type="submit">로그아웃</button>
              </form>
            </div>
          </details>
        </div>
        <AppNav links={[...work, ...manage]} variant="top" sepAfter={work.length} />
      </header>
      {children}
      <AppNav links={work.filter((l) => l.href !== '/corrections' || !admin).slice(0, 5)} variant="tabs" />
    </div>
  )
}
