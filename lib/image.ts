// 브라우저에서 사진 올리기 전에 크기를 줄임 (긴 변 maxSide px, JPEG) → 저장 공간·데이터·AI 비용 절약
// gray: 흑백으로 (전표처럼 글씨만 보면 되는 사진은 용량이 크게 줄어듦)
export async function shrinkImage(
  file: File,
  maxSide = 1600,
  { quality = 0.85, gray = false }: { quality?: number; gray?: boolean } = {},
): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')!
    if (gray) ctx.filter = 'grayscale(1)'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob) return blob
  } catch {
    // 줄이지 못하는 형식이면 원본 그대로
  }
  return file
}

export const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}
