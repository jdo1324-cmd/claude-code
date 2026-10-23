import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export async function getNfcToken(): Promise<string> {
  const { data, error } = await createAdminClient().from('store_settings').select('nfc_token').eq('id', 1).single()
  if (error || !data) throw new Error('매장 설정을 불러오지 못했습니다')
  return data.nfc_token as string
}

function tokenMatches(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type ClockResult = { error: string | null; needBreak: boolean }

// NFC 태그로 출근 또는 퇴근. 태그는 매장에만 붙어 있으므로 매장 코드가 맞으면 매장에서 찍은 것으로 봄.
// 출근/퇴근을 명시해서 보내므로, 버튼을 두 번 눌러도 반대 동작이 되지 않음.
export async function clockByNfc(userId: string, nfcToken: string, action: 'in' | 'out'): Promise<ClockResult> {
  if (!tokenMatches(nfcToken, await getNfcToken())) {
    return { error: 'NFC 태그가 만료되었습니다. 사장님께 문의하세요.', needBreak: false }
  }

  const fn = action === 'in' ? 'clock_in_for' : 'clock_out_for'
  const { error } = await createAdminClient().rpc(fn, { p_user_id: userId })
  if (!error) return { error: null, needBreak: false }
  return { error: error.message, needBreak: error.code === 'BRK01' }
}
