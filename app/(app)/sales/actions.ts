'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { notifyAdmins } from '@/lib/push'
import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

function back(key: 'ok' | 'error', message: string): never {
  revalidatePath('/sales')
  revalidatePath('/admin/sales')
  revalidatePath('/admin/checklists')
  redirect('/sales?' + key + '=' + encodeURIComponent(message))
}

// "1,234,000" → 1234000. 비어 있으면 0 (지출 칸), 숫자가 아니면 NaN
function won(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').replace(/[,\s원]/g, '')
  return raw === '' ? 0 : Number(raw)
}

export async function submitSalesReport(formData: FormData) {
  await getCurrentProfile()
  const amounts = {
    p_total: won(formData.get('total_sales')),
    p_card: won(formData.get('card_amount')),
    p_cash: won(formData.get('cash_amount')),
    p_other: won(formData.get('other_amount')),
    p_cash_expense: won(formData.get('cash_expense')),
    p_check_card_expense: won(formData.get('check_card_expense')),
  }
  if (Object.values(amounts).some((n) => !Number.isInteger(n) || n < 0)) {
    back('error', '금액은 0 이상의 숫자(원 단위)로 입력하세요.')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('submit_sales_report', {
    ...amounts,
    p_note: String(formData.get('note') ?? ''),
    p_replace_reason: String(formData.get('replace_reason') ?? ''),
  })
  if (error) back('error', error.message)

  const me = await getCurrentProfile()
  const diff = amounts.p_card + amounts.p_cash + amounts.p_other - amounts.p_total
  after(() =>
    notifyAdmins({
      title: diff !== 0 ? '⚠️ 매출 보고서 (금액 차이)' : '매출 보고서 제출',
      body:
        `${me.full_name}: 매출 ${amounts.p_total.toLocaleString('ko-KR')}원` +
        (diff !== 0 ? ` · 결제수단 합계 차이 ${diff.toLocaleString('ko-KR')}원` : ''),
      url: '/admin/home',
    }),
  )
  back('ok', '매출 정산 보고서를 저장했습니다.')
}
