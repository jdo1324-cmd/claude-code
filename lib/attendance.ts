import type { EmploymentType } from '@/lib/auth'

export type BreakRow = {
  id: number
  minutes: number
  status: 'valid' | 'void'
  reason: string | null
  entered_at: string
  void_reason: string | null
}

export type AttendanceRecord = {
  id: number
  user_id: string
  work_date: string
  clock_in: string
  clock_out: string | null
  auto_clock_out: boolean
  status: 'valid' | 'void'
  source: 'nfc' | 'admin' | 'correction'
  replaces_id: number | null
  void_reason: string | null
  voided_at: string | null
  attendance_breaks: BreakRow[]
}

export type AttendanceWithProfile = AttendanceRecord & {
  profiles: { full_name: string; employment_type: EmploymentType } | null
}

export const ATTENDANCE_SELECT =
  'id, user_id, work_date, clock_in, clock_out, auto_clock_out, status, source, replaces_id, void_reason, voided_at, ' +
  'attendance_breaks(id, minutes, status, reason, entered_at, void_reason)'

// attendance → profiles 연결이 여러 개(user_id, created_by, voided_by)라 user_id 쪽을 명시
export const ATTENDANCE_WITH_PROFILE_SELECT =
  ATTENDANCE_SELECT + ', profiles!attendance_user_id_fkey(full_name, employment_type)'

// 휴게시간 선택지: 0 ~ 4시간, 0.5시간 단위
export const BREAK_OPTIONS = Array.from({ length: 9 }, (_, i) => i * 30)

export function breakLabel(minutes: number) {
  return `${minutes / 60}시간`
}

export function validBreak(record: AttendanceRecord): number | null {
  return record.attendance_breaks.find((b) => b.status === 'valid')?.minutes ?? null
}

// 실근무 시간(분) = 퇴근 - 출근 - 휴게. 근무 중이거나 무효면 null.
export function netMinutes(record: AttendanceRecord): number | null {
  if (record.status !== 'valid' || !record.clock_out) return null
  const gross = Math.floor((new Date(record.clock_out).getTime() - new Date(record.clock_in).getTime()) / 60000)
  return Math.max(0, gross - (validBreak(record) ?? 0))
}

export function formatMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
}

export const SOURCE_LABEL = { nfc: 'NFC', admin: '관리자 입력', correction: '정정 승인' } as const

// 'YYYY-MM' → 그 달의 첫날/마지막날 (YYYY-MM-DD)
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

export function isMonth(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}
