'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Icon = 'home' | 'clock' | 'check' | 'won' | 'receipt' | 'edit'
export type NavLink = { href: string; label: string; icon?: Icon }

const ICON_PATH: Record<Icon, React.ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  check: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  won: <path d="m4 7 3 10 2.5-7 2.5 7 2.5-7 2.5 7 3-10M3.5 11h17M3.5 14h17" />,
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />,
}

// 지금 보는 화면 표시: 정확히 같은 주소이거나, 하위 주소(/admin/receipts/12 → 전표 확인)
function isCurrent(pathname: string, href: string, all: NavLink[]) {
  if (pathname === href) return true
  if (href === '/' || !pathname.startsWith(href + '/')) return false
  // 더 구체적인 메뉴가 있으면 그쪽을 표시 (/admin/hours 는 '관리'가 아니라 '월별 근무시간')
  return !all.some((l) => l.href !== href && l.href.startsWith(href + '/') && pathname.startsWith(l.href))
}

export function AppNav({
  links,
  variant,
  sepAfter,
}: {
  links: NavLink[]
  variant: 'top' | 'tabs' | 'menu'
  sepAfter?: number
}) {
  const pathname = usePathname()

  // 메뉴에서 고르면 펼친 메뉴를 닫음
  const closeMenu = (e: React.MouseEvent) => {
    e.currentTarget.closest('details')?.removeAttribute('open')
  }

  if (variant === 'tabs') {
    return (
      <nav className="tab-bar" aria-label="주요 메뉴" style={{ gridTemplateColumns: `repeat(${links.length}, 1fr)` }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={isCurrent(pathname, l.href, links) ? 'page' : undefined}>
            {l.icon && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {ICON_PATH[l.icon]}
              </svg>
            )}
            {l.label.replace(' 올리기', '').replace('관리자 홈', '홈').replace('사장 홈', '홈')}
          </Link>
        ))}
      </nav>
    )
  }

  if (variant === 'menu') {
    return (
      <>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={closeMenu}
            aria-current={isCurrent(pathname, l.href, links) ? 'page' : undefined}
          >
            {l.label}
          </Link>
        ))}
      </>
    )
  }

  return (
    <nav className="top-nav" aria-label="메뉴">
      {links.map((l, i) => (
        <span key={l.href} style={{ display: 'contents' }}>
          {sepAfter !== undefined && i === sepAfter && <span className="nav-sep" aria-hidden />}
          <Link href={l.href} aria-current={isCurrent(pathname, l.href, links) ? 'page' : undefined}>
            {l.label}
          </Link>
        </span>
      ))}
    </nav>
  )
}
