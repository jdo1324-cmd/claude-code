import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// 사장/관리자에게 가는 알림 종류. scheduled = 정해진 시각에 한 번, event = 일이 생기면 바로
export const ALERT_KINDS = {
  checklist_reminder: {
    label: '체크리스트 미완료',
    description: '오늘 아직 안 된 체크리스트 항목(필수는 오픈/미들/마감별, 선택 항목, 이번 주·이번 달 남은 업무)',
    scheduled: true,
  },
  daily_summary: {
    label: '놓친 일 점검',
    description:
      '퇴근 태그 누락(자동 퇴근), 아르바이트 휴게시간 미입력, 매출 보고서 미제출, 사진 없는 완료. 보낼 시각 이후에 알게 된 일(예: 밤에 자동 퇴근 처리된 것)은 다음 날 알림에 포함',
    scheduled: true,
  },
  correction: { label: '정정 요청', description: '직원이 출퇴근 정정 요청을 보낼 때 바로', scheduled: false },
  receipt: { label: '전표 확인 대기', description: '올라온 전표를 AI가 다 읽었을 때 바로', scheduled: false },
  sales_report: {
    label: '매출 보고서',
    description: '매출 정산 보고서가 제출될 때 바로 (금액 차이 표시)',
    scheduled: false,
  },
} as const

export type AlertKind = keyof typeof ALERT_KINDS

export type AlertSetting = { kind: AlertKind; enabled: boolean; send_time: string | null }

export async function getAlertSettings(): Promise<AlertSetting[]> {
  const { data } = await createAdminClient().from('alert_settings').select('kind, enabled, send_time')
  return (data ?? []) as AlertSetting[]
}

export async function isAlertEnabled(kind: AlertKind) {
  const { data } = await createAdminClient().from('alert_settings').select('enabled').eq('kind', kind).maybeSingle()
  return data?.enabled ?? true
}
