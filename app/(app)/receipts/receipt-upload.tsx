'use client'

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
  const [done, setDone] = useState(false)

  function removePhoto(index: number) {
    URL.revokeObjectURL(photos[index].url)
    setPhotos(photos.filter((_, j) => j !== index))
  }

  function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file || photos.length >= MAX_PHOTOS) return
    setPhotos([...photos, { file, url: URL.createObjectURL(file) }])
    setDone(false)
  }

  async function submit() {
    if (photos.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const paths: string[] = []
      for (const p of photos) {
        const blob = await shrinkImage(p.file, 2000) // 글씨를 읽어야 하므로 조금 크게
        const ext = IMAGE_EXT[blob.type]
        if (!ext || ext === 'heic' || ext === 'heif') throw new Error('JPG/PNG 사진만 올릴 수 있습니다. 카메라로 다시 찍어 주세요.')
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
      setPhotos([])
      setNote('')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '전표를 올리지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {done && (
        <p style={{ color: 'green', fontWeight: 'bold' }}>
          ✅ 전표를 올렸습니다. 사장님·관리자가 확인합니다. 다른 전표가 있으면 이어서 올려 주세요.
        </p>
      )}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        {photos.map((p, i) => (
          <div key={p.url} style={{ border: '1px solid #ccc', padding: 4, textAlign: 'center' }}>
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
        <label style={{ display: 'inline-block', border: '1px solid #333', padding: '8px 16px', cursor: 'pointer' }}>
          📷 {photos.length === 0 ? '전표 사진 찍기' : `다음 장 찍기 (${photos.length}/${MAX_PHOTOS})`}
          <input type="file" accept="image/*" capture="environment" onChange={addPhoto} disabled={busy} style={{ display: 'none' }} />
        </label>
      )}
      <p style={{ fontSize: 13 }}>전표가 여러 장이면 최대 {MAX_PHOTOS}장까지 이어서 찍을 수 있습니다. 글씨가 잘 보이게 찍어 주세요.</p>

      <p>
        <label>
          메모 (선택)
          <br />
          <input value={note} onChange={(e) => setNote(e.target.value)} size={30} placeholder="예: 가나청과 아침 배송" disabled={busy} />
        </label>
      </p>
      <button type="button" onClick={submit} disabled={busy || photos.length === 0} style={{ fontSize: 18, padding: '8px 24px' }}>
        {busy ? '올리는 중…' : `전표 올리기 (${photos.length}장)`}
      </button>
    </div>
  )
}
