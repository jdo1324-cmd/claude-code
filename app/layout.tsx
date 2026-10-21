import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '매장 운영 관리',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto', padding: 16 }}>
        {children}
      </body>
    </html>
  )
}
