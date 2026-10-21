'use client'

import { useState } from 'react'

// 누르면 글을 복사하고 "복사됨"으로 잠깐 바뀜
export function CopyButton({ text, label = '복사하기' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          window.prompt('아래 내용을 길게 눌러 복사하세요.', text)
        }
      }}
    >
      {copied ? '✓ 복사됨' : label}
    </button>
  )
}
