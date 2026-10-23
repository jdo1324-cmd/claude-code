'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isMonth } from '@/lib/attendance'
import { requireAdmin } from '@/lib/auth'
import { sendDayLaborToSheet } from '@/lib/google-sheet'
import { createAdminClient } from '@/lib/supabase/admin'

function back(month: string, key: 'ok' | 'error', message: string): never {
  revalidatePath('/admin/day-labor')
  redirect(`/admin/day-labor?month=${month}&${key}=${encodeURIComponent(message)}`)
}

function amount(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').replace(/[,\s원]/g, '')
  return raw === '' ? 0 : Number(raw)
}

// 일용직 근무 기록 추가
export async function addDayLabor(formData: FormData) {
  const me = await requireAdmin()
  const date = String(formData.get('work_date') ?? '')
  const month = date.slice(0, 7)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back(month || '', 'error', '날짜를 골라 주세요.')
  const name = String(formData.get('worker_name') ?? '').trim()
  const hours = Number(String(formData.get('hours') ?? '').replace(',', '.'))
  const wage = amount(formData.get('daily_wage'))
  const extra = amount(formData.get('extra_pay'))
  if (!name) back(month, 'error', '이름을 적어 주세요.')
  if (!(hours > 0 && hours <= 24)) back(month, 'error', '근무시간은 0보다 크고 24 이하로 적어 주세요.')
  if (!Number.isInteger(wage) || wage < 0) back(month, 'error', '일급은 원 단위 숫자로 적어 주세요.')
  if (!Number.isInteger(extra) || extra < 0) back(month, 'error', '추가근무 수당은 원 단위 숫자로 적어 주세요.')

  const { error } = await createAdminClient()
    .from('day_labor_entries')
    .insert({
      work_date: date,
      worker_name: name,
      hours,
      daily_wage: wage,
      extra_pay: extra,
      note: String(formData.get('note') ?? '').trim() || null,
      created_by: me.id,
    })
  if (error) back(month, 'error', '저장하지 못했습니다: ' + error.message)
  back(month, 'ok', `${date} ${name} 기록을 추가했습니다.`)
}

// 잘못 적은 기록 지우기 (기록은 "지움"으로 남고, 다음 시트 전송 때 그 칸을 비움)
export async function voidDayLabor(formData: FormData) {
  const me = await requireAdmin()
  const month = String(formData.get('month') ?? '')
  const { error } = await createAdminClient()
    .from('day_labor_entries')
    .update({ status: 'void', voided_by: me.id, voided_at: new Date().toISOString() })
    .eq('id', Number(formData.get('id')))
    .eq('status', 'valid')
  if (error) back(month, 'error', '지우지 못했습니다: ' + error.message)
  back(month, 'ok', '기록을 지웠습니다. 구글 시트에는 다음 전송 때 반영됩니다.')
}

export async function sendDayLaborSheet(formData: FormData) {
  const me = await requireAdmin()
  const month = String(formData.get('month') ?? '')
  if (!isMonth(month)) back('', 'error', '달을 골라 주세요.')
  const reply = await sendDayLaborToSheet(month, me.id)
  if (!reply.ok) back(month, 'error', reply.error ?? '구글 시트로 보내지 못했습니다.')
  const parts = [
    `"${reply.tab}" 탭 일용직 구역에 ${reply.written?.length ?? 0}명의 기록을 넣었습니다.`,
    reply.created && '탭이 없어서 "X월 인건비"를 복사해 새로 만들었습니다.',
    reply.added?.length &&
      `시트에 없던 이름을 빈 줄에 추가: ${reply.added.join(', ')} (주민번호는 시트에서 직접 적어 주세요)`,
    reply.unmatched?.length && `⚠️ 넣지 못한 사람: ${reply.unmatched.join(', ')}`,
  ].filter(Boolean)
  back(month, reply.unmatched?.length ? 'error' : 'ok', parts.join('\n'))
}
