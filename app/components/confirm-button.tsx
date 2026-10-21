'use client'

import { useFormStatus } from 'react-dom'

// 누르면 확인창을 띄우고, [확인]일 때만 제출. 제출 중에는 다시 누를 수 없음.
export function ConfirmButton({
  children,
  message,
  style,
}: {
  children: React.ReactNode
  message: string
  style?: React.CSSProperties
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      style={style}
      onClick={(e) => {
        // 휴게시간처럼 고를 값이 있으면 확인 문구에 넣어 줌
        const form = e.currentTarget.form
        const select = form?.querySelector('select[name="minutes"]') as HTMLSelectElement | null
        const chosen = select?.selectedOptions[0]?.text
        if (select?.required && !select.value) return // 브라우저의 "필수 입력" 안내가 뜨도록
        if (!window.confirm(chosen ? message.replace('{value}', chosen) : message)) e.preventDefault()
      }}
    >
      {pending ? '처리 중…' : children}
    </button>
  )
}
