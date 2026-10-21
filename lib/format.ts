const TZ = 'Asia/Seoul'

export const ROLE_LABEL = { owner: '사장', manager: '관리자', staff: '직원' } as const
export const EMPLOYMENT_LABEL = { full_time: '정규직', part_time: '아르바이트' } as const

// 한국 시간 기준 오늘 날짜 (YYYY-MM-DD)
export function todayKST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

// <input type="datetime-local"> 용: ISO → 한국 시간 'YYYY-MM-DDTHH:mm'
export function toKstInput(iso: string | null | undefined) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(' ', 'T')
}

// 한국 시간 'YYYY-MM-DDTHH:mm' → ISO. 형식이 틀리면 null.
export function fromKstInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const d = new Date(`${value}:00+09:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function formatDuration(from: string, to: string | null) {
  if (!to) return '근무 중'
  const minutes = Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60000)
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
}
