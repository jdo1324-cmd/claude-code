'use server'

import { after } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { readReceipt } from '@/lib/receipt-ai'
import { createClient } from '@/lib/supabase/server'

// 직원: 사진을 올린 뒤 호출. 저장 후 AI 읽기는 응답을 돌려준 다음 백그라운드에서 진행.
export async function submitReceipt(paths: string[], note: string): Promise<{ error: string | null }> {
  await getCurrentProfile()
  const supabase = await createClient()
  const { data: id, error } = await supabase.rpc('submit_receipt', { p_paths: paths, p_note: note })
  if (error) return { error: error.message }

  after(() => readReceipt(Number(id)))
  return { error: null }
}
