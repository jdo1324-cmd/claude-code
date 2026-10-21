'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireOwner } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

function back(key: 'ok' | 'error', message: string): never {
  revalidatePath('/admin/pay')
  revalidatePath('/')
  redirect('/admin/pay?' + key + '=' + encodeURIComponent(message))
}

export async function addPayRate(formData: FormData) {
  await requireOwner()
  const amount = Number(String(formData.get('amount') ?? '').replace(/[,\s원]/g, ''))
  if (!Number.isInteger(amount) || amount <= 0) back('error', '금액은 원 단위 숫자로 입력하세요.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('add_pay_rate', {
    p_user_id: String(formData.get('user_id') ?? ''),
    p_pay_type: String(formData.get('pay_type') ?? ''),
    p_amount: amount,
    p_effective_from: String(formData.get('effective_from') ?? ''),
    p_note: String(formData.get('note') ?? ''),
  })
  if (error) back('error', error.message)
  back('ok', '급여 정보를 등록했습니다.')
}

export async function voidPayRate(formData: FormData) {
  await requireOwner()
  const supabase = await createClient()
  const { error } = await supabase.rpc('void_pay_rate', {
    p_rate_id: Number(formData.get('id')),
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back('error', error.message)
  back('ok', '무효 처리했습니다. 이력에는 남습니다.')
}
