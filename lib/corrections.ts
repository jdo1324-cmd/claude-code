export type CorrectionRequest = {
  id: number
  user_id: string
  request_type: 'modify' | 'add' | 'void'
  attendance_id: number | null
  proposed_clock_in: string | null
  proposed_clock_out: string | null
  proposed_break_minutes: number | null
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  created_at: string
  reviewed_at: string | null
  review_note: string | null
}

export const CORRECTION_SELECT =
  'id, user_id, request_type, attendance_id, proposed_clock_in, proposed_clock_out, proposed_break_minutes, ' +
  'reason, status, created_at, reviewed_at, review_note'

export const REQUEST_TYPE_LABEL = { modify: '시간 수정', add: '기록 추가', void: '기록 무효' } as const
export const REQUEST_STATUS_LABEL = {
  pending: '대기 중',
  approved: '승인',
  rejected: '거절',
  cancelled: '취소',
} as const
