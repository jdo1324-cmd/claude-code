'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isMonth } from '@/lib/attendance'
import { requireOwner } from '@/lib/auth'
import { todayKST } from '@/lib/format'
import { sendLaborToSheet } from '@/lib/google-sheet'

// 월별 출퇴근 기록 → 손익계산서 "N월 인건비" 탭 (사장 전용)
export async function sendHoursToSheet(formData: FormData) {
  const me = await requireOwner()
  const month = String(formData.get('month') ?? '')
  if (!isMonth(month)) redirect('/admin/hours')
  const raw = String(formData.get('early_leave_hours') ?? '').trim()
  const earlyLeave = raw === '' ? null : Number(raw)
  const back = (key: 'ok' | 'error', message: string): never => {
    revalidatePath('/admin/hours')
    redirect(`/admin/hours?month=${month}&${key}=${encodeURIComponent(message)}`)
  }
  if (earlyLeave !== null && !(earlyLeave > 0 && earlyLeave < 24))
    back('error', '조퇴 기준 시간은 1~23 사이 숫자로 적어 주세요.')

  const reply = await sendLaborToSheet(month, earlyLeave, me.id, todayKST())
  if (!reply.ok) back('error', reply.error ?? '손익계산서로 보내지 못했습니다.')

  const parts = [
    `"${reply.tab}" 탭에 ${reply.written?.length ?? 0}명의 출퇴근 기록을 넣었습니다.`,
    reply.created && '탭이 없어서 "X월 인건비"를 복사해 새로 만들었습니다.',
    reply.added?.length && `시트에 없던 직원을 빈 줄에 추가: ${reply.added.join(', ')}`,
    reply.unmatched?.length && `⚠️ 넣지 못한 직원: ${reply.unmatched.join(', ')} (시트에 빈 줄을 만들어 주세요)`,
  ].filter(Boolean)
  back(reply.unmatched?.length ? 'error' : 'ok', parts.join('\n'))
}
