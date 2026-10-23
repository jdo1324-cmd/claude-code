import 'server-only'
import { FEATURES } from '@/lib/features'
import { createAdminClient } from '@/lib/supabase/admin'

// 사장/관리자에게 가는 알림 종류. scheduled = 정해진 시각에 한 번, event = 일이 생기면 바로
export const ALERT_KINDS = {
  checklist_reminder: {
    label: '체크리스트 미완료',
    description: '오늘 아직 안 된 체크리스트 항목(필수는 오픈/미들/마감별, 선택 항목, 이번 주·이번 달 남은 업무)',
    scheduled: true,
  },
  missed_clock_out: {
    label: '퇴근 태그 누락',
    description:
      '퇴근 태그를 안 찍어 21:00로 자동 퇴근 처리된 직원. 자동 퇴근은 밤 21:30에 처리되므로 보통 다음 날 알림에 나옴',
    scheduled: true,
  },
  missing_break: {
    label: '휴게시간 미입력',
    description: '퇴근했는데 휴게시간을 입력하지 않은 아르바이트 (근무시간·급여 계산에 영향)',
    scheduled: true,
  },
  photo_issue: {
    label: '사진 문제',
    description: '사진 항목의 사진 파일이 사라진 완료 기록 (사진 없이 완료하는 것은 앱과 DB에서 막혀 있음)',
    scheduled: true,
  },
  missing_sales_report: {
    label: '매출 보고서 미제출',
    description: '매출 정산 보고서가 제출되지 않은 날',
    scheduled: true,
    feature: 'salesReport',
  },
  correction: { label: '정정 요청', description: '직원이 출퇴근 정정 요청을 보낼 때 바로', scheduled: false },
  receipt: { label: '전표 확인 대기', description: '올라온 전표를 AI가 다 읽었을 때 바로', scheduled: false },
  sales_report: {
    label: '매출 보고서',
    description: '매출 정산 보고서가 제출될 때 바로 (금액 차이 표시)',
    scheduled: false,
    feature: 'salesReport',
  },
} as const

// 놓친 일 점검 알림 종류 ↔ 자동 점검(findAlerts)의 항목 이름
export const SUMMARY_KIND_LABEL = {
  missed_clock_out: '퇴근 태그 누락',
  missing_break: '휴게시간 미입력',
  photo_issue: '사진 없는 완료',
  missing_sales_report: '매출 보고서 미제출',
} as const

// 알림을 보내는 길 (휴대폰 웹 알림은 사장님 요청으로 2026-10 꺼 둠, 잔디는 잔디 연결 화면에서)
export const WEB_PUSH_CHANNEL = 'channel_web_push'

export function isKindVisible(kind: AlertKind) {
  const def = ALERT_KINDS[kind] as { feature?: keyof typeof FEATURES }
  return !def.feature || FEATURES[def.feature]
}

export type AlertKind = keyof typeof ALERT_KINDS

export type AlertSetting = {
  kind: AlertKind | typeof WEB_PUSH_CHANNEL | 'daily_summary'
  enabled: boolean
  send_time: string | null
}

export async function getAlertSettings(): Promise<AlertSetting[]> {
  const { data } = await createAdminClient().from('alert_settings').select('kind, enabled, send_time')
  return (data ?? []) as AlertSetting[]
}

export async function isWebPushEnabled() {
  const { data } = await createAdminClient()
    .from('alert_settings')
    .select('enabled')
    .eq('kind', WEB_PUSH_CHANNEL)
    .maybeSingle()
  return data?.enabled ?? false
}

export async function isAlertEnabled(kind: AlertKind) {
  if (!isKindVisible(kind)) return false
  const { data } = await createAdminClient().from('alert_settings').select('enabled').eq('kind', kind).maybeSingle()
  return data?.enabled ?? true
}
