'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { IMAGE_EXT, shrinkImage } from '@/lib/image'
import { createClient } from '@/lib/supabase/client'
import { completePhotoItem } from './actions'

export function PhotoUpload({ itemId, date }: { itemId: number; date: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const blob = await shrinkImage(file)
      const ext = IMAGE_EXT[blob.type]
      if (!ext) throw new Error('사진 파일만 올릴 수 있습니다.')
      // 폴더 = 오늘 날짜 (저장소 규칙상 오늘 폴더에만 올릴 수 있음)
      const path = `${date}/${itemId}-${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await createClient()
        .storage.from('checklist-photos')
        .upload(path, blob, { contentType: blob.type })
      if (uploadError) {
        throw new Error(`사진 올리기 실패: ${uploadError.message} (날짜가 바뀌었다면 화면을 새로고침하세요)`)
      }
      const result = await completePhotoItem(itemId, path)
      if (result.error) throw new Error(result.error)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진을 올리지 못했습니다.')
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  return (
    <div>
      <label className="file-button">
        {busy ? '올리는 중…' : '📷 사진 찍기'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onChange}
          disabled={busy}
          style={{ display: 'none' }}
        />
      </label>
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}
