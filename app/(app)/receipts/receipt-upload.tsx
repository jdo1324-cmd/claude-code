'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { IMAGE_EXT, shrinkImage } from '@/lib/image'
import { createClient } from '@/lib/supabase/client'
import { submitReceipt } from './actions'

const MAX_PHOTOS = 3

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
          📷 {photos.length === 0 ? '전표 사진 찍기' : `다음 장 찍기 (${photos.length}/${MAX_PHOTOS})`}
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
        전표가 여러 장이면 최대 {MAX_PHOTOS}장까지 이어서 찍을 수 있습니다. 글씨가 잘 보이게 찍어 주세요.
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
        {busy ? '올리는 중…' : `전표 올리기 (${photos.length}장)`}
      </button>
    </div>
  )
}
