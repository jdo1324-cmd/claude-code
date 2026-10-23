'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isMonth } from '@/lib/attendance'
import { requireAdmin } from '@/lib/auth'
import { getSheetSettings, sendDayLaborRrnToSheet, sendDayLaborToSheet } from '@/lib/google-sheet'
import { createAdminClient } from '@/lib/supabase/admin'

function back(month: string, key: 'ok' | 'error', message: string): never {
  revalidatePath('/admin/day-labor')
  redirect(`/admin/day-labor?month=${month}&${key}=${encodeURIComponent(message)}`)
}

function amount(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').replace(/[,\s원]/g, '')
  return raw === '' ? 0 : Number(raw)
}

// 기록을 추가하거나 지울 때마다 그 달 일용직 구역을 앱 기록과 똑같이 맞춤 (시트가 연결돼 있을 때)
async function syncSheet(month: string, userId: string) {
  if (!(await getSheetSettings()).webhook_url) return ''
  const reply = await sendDayLaborToSheet(month, userId)
  if (!reply.ok)
    return `\n⚠️ 구글 시트에는 반영하지 못했습니다: ${reply.error} — 아래 [구글 시트로 전송]으로 다시 보내 주세요.`
  if (reply.unmatched?.length) return `\n⚠️ 시트에 넣지 못한 사람: ${reply.unmatched.join(', ')}`
  return ' 구글 시트에도 반영했습니다.'
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

  // 주민번호는 앱에 저장하지 않고 손익계산서 일용직 구역의 주민번호 칸에 바로 적음
  const rrnDigits = String(formData.get('rrn') ?? '').replace(/[\s-]/g, '')
  let rrnNote = ''
  if (rrnDigits) {
    if (!/^\d{13}$/.test(rrnDigits)) back(month, 'error', '주민번호는 숫자 13자리로 적어 주세요. (예: 900101-1234567)')
    const reply = await sendDayLaborRrnToSheet(month, name, `${rrnDigits.slice(0, 6)}-${rrnDigits.slice(6)}`)
    if (!reply.ok) back(month, 'error', '주민번호를 구글 시트에 적지 못해 기록도 저장하지 않았습니다: ' + reply.error)
    rrnNote = ` 주민번호는 "${reply.tab}" 탭에 적었습니다(앱에는 저장 안 함).`
  }

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
  back(month, 'ok', `${date} ${name} 기록을 추가했습니다.${rrnNote}${await syncSheet(month, me.id)}`)
}

// 잘못 적은 기록 지우기 (기록은 "지움"으로 남고, 시트의 그 칸은 비움)
export async function voidDayLabor(formData: FormData) {
  const me = await requireAdmin()
  const month = String(formData.get('month') ?? '')
  const { error } = await createAdminClient()
    .from('day_labor_entries')
    .update({ status: 'void', voided_by: me.id, voided_at: new Date().toISOString() })
    .eq('id', Number(formData.get('id')))
    .eq('status', 'valid')
  if (error) back(month, 'error', '지우지 못했습니다: ' + error.message)
  back(month, 'ok', `기록을 지웠습니다.${await syncSheet(month, me.id)}`)
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
      `시트에 없던 이름을 빈 줄에 추가: ${reply.added.join(', ')} (주민번호 칸이 비어 있으면 시트에서 적어 주세요)`,
    reply.unmatched?.length && `⚠️ 넣지 못한 사람: ${reply.unmatched.join(', ')}`,
  ].filter(Boolean)
  back(month, reply.unmatched?.length ? 'error' : 'ok', parts.join('\n'))
}
