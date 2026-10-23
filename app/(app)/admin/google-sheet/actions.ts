'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireOwner } from '@/lib/auth'
import { isValidWebhookUrl, refreshLedgerItems, testConnection } from '@/lib/google-sheet'
import { createAdminClient } from '@/lib/supabase/admin'

function connectionText(reply: Awaited<ReturnType<typeof testConnection>>) {
  if (reply.wrongFile)
    return `⚠️ 지금 웹 앱 URL은 "${reply.sheetName}"(매장 매출 매입 장부)에 붙인 코드의 주소입니다. 손익계산서에 붙인 코드의 웹 앱 URL로 바꿔 주세요. (장부 파일에는 코드가 필요 없습니다)`
  return [
    `· 인건비·일용직 → 손익계산서: "${reply.sheetName}" ✅`,
    reply.ledgerName
      ? `· 전표 → 매장 매출 매입 장부: "${reply.ledgerName}" ✅`
      : '· 전표 → 매장 매출 매입 장부: ⚠️ 열지 못함 (Apps Script에서 checkLedgerAccess 를 ▶ 실행해 권한을 허용하고, 새 버전으로 배포해 주세요)',
  ].join('\n')
}

function back(key: 'ok' | 'error', message: string): never {
  revalidatePath('/admin/google-sheet')
  redirect('/admin/google-sheet?' + key + '=' + encodeURIComponent(message))
}

// Apps Script 웹 앱 주소 저장 → 바로 연결 확인
export async function saveWebhookUrl(formData: FormData) {
  const me = await requireOwner()
  const url = String(formData.get('webhook_url') ?? '').trim()
  if (!isValidWebhookUrl(url)) {
    back(
      'error',
      '주소가 올바르지 않습니다. https://script.google.com/macros/s/…/exec 형태의 "웹 앱 URL"을 붙여 넣어 주세요.',
    )
  }
  const { error } = await createAdminClient()
    .from('google_sheet_settings')
    .update({ webhook_url: url, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) back('error', '저장하지 못했습니다: ' + error.message)

  const reply = await testConnection()
  if (!reply.ok) back('error', '주소는 저장했지만 연결 확인에 실패했습니다: ' + (reply.error ?? '알 수 없는 오류'))
  back(reply.wrongFile ? 'error' : 'ok', (reply.wrongFile ? '' : '연결되었습니다!\n') + connectionText(reply))
}

export async function testSheet() {
  await requireOwner()
  const reply = await testConnection()
  if (!reply.ok) back('error', reply.error ?? '연결 확인에 실패했습니다.')
  back(reply.ledgerName && !reply.wrongFile ? 'ok' : 'error', '연결 확인 결과\n' + connectionText(reply))
}

// 비밀값이 새어 나간 것 같을 때: 새 값으로 바꾸면 예전 코드로는 받을 수 없음
export async function regenerateSecret() {
  const me = await requireOwner()
  const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const { error } = await createAdminClient()
    .from('google_sheet_settings')
    .update({ secret, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) back('error', '바꾸지 못했습니다: ' + error.message)
  back('ok', '비밀값을 바꿨습니다. 아래 코드를 다시 복사해서 Apps Script에 붙여 넣고 "새 배포"를 해 주세요.')
}

// 장부의 품목 줄을 다시 읽어 전표 확인 화면의 "장부 품목" 목록을 새로 고침
export async function refreshLedger() {
  await requireOwner()
  const reply = await refreshLedgerItems()
  if (!reply.ok) back('error', '장부 품목을 불러오지 못했습니다: ' + reply.error)
  back('ok', `장부 "${reply.tab}" 탭에서 품목 ${reply.count}개를 불러왔습니다.`)
}
