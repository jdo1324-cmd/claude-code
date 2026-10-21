import type { MetadataRoute } from 'next'

// 홈 화면에 추가했을 때 앱처럼 열리게 (아이폰은 이렇게 해야 푸시 알림을 받을 수 있음)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '매장 운영 관리',
    short_name: '매장관리',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2a6f4f',
    icons: [{ src: '/icon', sizes: '512x512', type: 'image/png' }],
  }
}
