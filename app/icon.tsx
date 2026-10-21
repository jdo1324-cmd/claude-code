import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

// 앱 아이콘 (홈 화면 · 알림)
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1f6b52',
          color: 'white',
          fontSize: 200,
          fontWeight: 700,
          borderRadius: 96,
        }}
      >
        OPS
      </div>
    ),
    size,
  )
}
