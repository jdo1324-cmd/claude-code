'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { IMAGE_EXT, shrinkImage } from '@/lib/image'
import { createClient } from '@/lib/supabase/client'
import { submitReceipt } from './actions'

// 전표는 한 번에 1장씩 (여러 장짜리 전표는 장마다 따로 올림)
const MAX_PHOTOS = 1

export function ReceiptUpload({ date }: { date: string }) {
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function removePhoto(index: number) {
    URL.revokeObjectURL(photos[index].url)
    setPhotos(photos.filter((_, j) => j !== index))
  }

  function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file || photos.length >= MAX_PHOTOS) return
    setPhotos([...photos, { file, url: URL.createObjectURL(file) }])
  }

  async function submit() {
    if (photos.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const paths: string[] = []
      for (const p of photos) {
        // 글씨만 읽으면 되므로 흑백·낮은 화질로 저장 용량을 줄임 (한 장 100~200KB 정도)
        const blob = await shrinkImage(p.file, 1600, { quality: 0.6, gray: true })
        const ext = IMAGE_EXT[blob.type]
        if (!ext || ext === 'heic' || ext === 'heif')
          throw new Error('JPG/PNG 사진만 올릴 수 있습니다. 카메라로 다시 찍어 주세요.')
        const path = `${date}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('receipt-photos')
          .upload(path, blob, { contentType: blob.type })
        if (uploadError) throw new Error(`사진 올리기 실패: ${uploadError.message} (날짜가 바뀌었다면 새로고침하세요)`)
        paths.push(path)
      }
      const result = await submitReceipt(paths, note)
      if (result.error) throw new Error(result.error)
      photos.forEach((p) => URL.revokeObjectURL(p.url))
      // AI가 다 읽으면 그 화면에서 바로 확인·확정
      router.push(`/receipts/${result.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '전표를 올리지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <div>
      {error && <p className="alert alert-error">{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        {photos.map((p, i) => (
          <div key={p.url} style={{ border: '1px solid var(--border)', padding: 4, textAlign: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`전표 ${i + 1}`} style={{ height: 120 }} />
            <div>
              {i + 1}장{' '}
              <button type="button" disabled={busy} onClick={() => removePhoto(i)}>
                빼기
              </button>
            </div>
          </div>
        ))}
      </div>

      {photos.length < MAX_PHOTOS && (
        <label className="file-button">
          📷 전표 사진 찍기
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={addPhoto}
            disabled={busy}
            style={{ display: 'none' }}
          />
        </label>
      )}
      <p className="small muted">
        전표 1장을 글씨가 잘 보이게 찍어 주세요. 다시 찍으려면 [빼기]를 누르세요. 전표가 여러 장이면 장마다 따로 올려
        주세요.
      </p>

      <p>
        <label>
          메모 (선택)
          <br />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size={30}
            placeholder="예: 가나청과 아침 배송"
            disabled={busy}
          />
        </label>
      </p>
      <button type="button" onClick={submit} disabled={busy || photos.length === 0} className="btn-lg">
        {busy ? '올리는 중…' : '전표 올리기'}
      </button>
    </div>
  )
}
