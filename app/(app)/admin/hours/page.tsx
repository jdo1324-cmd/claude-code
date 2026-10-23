import Link from 'next/link'
import {
  ATTENDANCE_SELECT,
  formatMinutes,
  isMonth,
  monthRange,
  netMinutes,
  validBreak,
  type AttendanceRecord,
} from '@/lib/attendance'
import { ConfirmButton } from '@/app/components/confirm-button'
import { requireAdmin, type Profile } from '@/lib/auth'
import { firstAttendanceDate, laborRange } from '@/lib/google-sheet'
import { EMPLOYMENT_LABEL, ROLE_LABEL, todayKST } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { sendHoursToSheet } from './actions'

export const maxDuration = 120

type Summary = {
  days: number
  netMinutes: number
  breakMinutes: number
  autoClockOuts: number
  missingBreaks: number
  working: number
}

function summarize(records: AttendanceRecord[], partTime: boolean): Summary {
  const s: Summary = { days: 0, netMinutes: 0, breakMinutes: 0, autoClockOuts: 0, missingBreaks: 0, working: 0 }
  for (const r of records) {
    const net = netMinutes(r)
    if (net === null) {
      s.working++
      continue
    }
    const brk = validBreak(r)
    s.days++
    s.netMinutes += net
    s.breakMinutes += brk ?? 0
    if (r.auto_clock_out) s.autoClockOuts++
    if (partTime && brk === null) s.missingBreaks++
  }
  return s
}

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; ok?: string; error?: string }>
}) {
  const { month: monthParam, ok, error: sendError } = await searchParams
  const me = await requireAdmin()
  const isOwner = me.role === 'owner'
  const month = isMonth(monthParam) ? monthParam : todayKST().slice(0, 7)
  const { start, end } = monthRange(month)
  const supabase = await createClient()

  const [{ data: profileData }, { data: recordData, error }, firstDate, { data: exportData }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('status', 'valid') // 무효 기록은 합계에서 제외
      .gte('work_date', start)
      .lte('work_date', end),
    isOwner ? firstAttendanceDate() : Promise.resolve(null),
    isOwner
      ? supabase
          .from('labor_sheet_exports')
          .select('sent_at, from_day, to_day')
          .eq('month', month)
          .order('sent_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] }),
  ])
  const range = laborRange(month, firstDate, todayKST())
  const lastExport = (exportData ?? [])[0] as { sent_at: string; from_day: number; to_day: number } | undefined
  const monthNo = Number(month.slice(5))
  const employees = (profileData ?? []) as Profile[]
  const records = (recordData ?? []) as unknown as AttendanceRecord[]

  const rows = employees
    .map((e) => ({
      e,
      s: summarize(
        records.filter((r) => r.user_id === e.id),
        e.employment_type === 'part_time',
      ),
    }))
    .filter(({ e, s }) => e.is_active || s.days > 0 || s.working > 0)
  const total = rows.reduce((sum, { s }) => sum + s.netMinutes, 0)

  return (
    <main>
      <h1>월별 근무시간</h1>
      <p>
        <Link href="/admin">◀ 관리로 돌아가기</Link>
      </p>
      <form method="get">
        <input type="month" name="month" defaultValue={month} /> <button type="submit">보기</button>
      </form>
      {error && <p className="alert alert-error">기록을 불러오지 못했습니다: {error.message}</p>}
      {sendError && <p className="alert alert-error">{sendError}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}
      <p>
        {month} ({start} ~ {end}) · 유효한 기록만 합산 · 실근무 = 퇴근 − 출근 − 휴게시간(아르바이트)
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>권한</th>
              <th>고용 형태</th>
              <th>근무일수</th>
              <th>총 실근무</th>
              <th>(시간)</th>
              <th>휴게 합계</th>
              <th>확인 필요</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, s }) => {
              const warnings = [
                s.autoClockOuts > 0 && `자동 퇴근 ${s.autoClockOuts}건`,
                s.missingBreaks > 0 && `휴게 미입력 ${s.missingBreaks}건`,
                s.working > 0 && `근무 중 ${s.working}건(합계 제외)`,
              ].filter(Boolean)
              return (
                <tr key={e.id} style={e.is_active ? undefined : { color: 'var(--faint)' }}>
                  <td>
                    {e.full_name}
                    {!e.is_active && ' (중지)'}
                  </td>
                  <td>{ROLE_LABEL[e.role]}</td>
                  <td>{EMPLOYMENT_LABEL[e.employment_type]}</td>
                  <td>{s.days}일</td>
                  <td>
                    <strong>{formatMinutes(s.netMinutes)}</strong>
                  </td>
                  <td>{(s.netMinutes / 60).toFixed(1)}h</td>
                  <td>{e.employment_type === 'part_time' ? formatMinutes(s.breakMinutes) : '-'}</td>
                  <td style={{ color: warnings.length ? 'var(--danger)' : undefined }}>{warnings.join(', ') || '-'}</td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={4}>
                <strong>합계</strong>
              </td>
              <td>
                <strong>{formatMinutes(total)}</strong>
              </td>
              <td>{(total / 60).toFixed(1)}h</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>
      {isOwner && (
        <section>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>손익계산서로 보내기</h2>
            {lastExport && (
              <span className="badge badge-ok">
                마지막 전송 {lastExport.sent_at.slice(0, 10)} ({lastExport.from_day}~{lastExport.to_day}일)
              </span>
            )}
          </div>
          {range ? (
            <form action={sendHoursToSheet}>
              <input type="hidden" name="month" value={month} />
              <p className="small muted">
                <strong>손익계산서</strong> &quot;{monthNo}월 인건비&quot; 탭의{' '}
                <strong>
                  날짜 칸({range.fromDay}일~{range.toDay}일)
                </strong>
                만 채웁니다. 이름이 같은 직원 줄을 찾아 정직원은 &quot;출근&quot;, 아르바이트는 그날 실근무 시간(휴게
                제외)을 넣습니다. 수식 칸과 {range.fromDay > 1 ? `${range.fromDay - 1}일 이전 칸(앱 사용 전), ` : ''}
                일용직 구역은 건드리지 않습니다. 탭이 없으면 &quot;X월 인건비&quot;를 복사해 만듭니다.
              </p>
              <label style={{ display: 'grid', gap: 4, maxWidth: 360 }}>
                정직원 조퇴 기준 (선택)
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input name="early_leave_hours" inputMode="decimal" placeholder="예: 8" style={{ width: 100 }} />
                  <span className="small muted">시간 미만 근무한 날은 &quot;출근&quot; 대신 근무시간으로</span>
                </div>
              </label>
              <div style={{ marginTop: 12 }}>
                <ConfirmButton
                  message={`${monthNo}월 출퇴근 기록을 손익계산서 "${monthNo}월 인건비" 탭으로 보낼까요?\n${range.fromDay}일~${range.toDay}일 날짜 칸이 앱 기록으로 바뀝니다.`}
                >
                  📤 손익계산서로 전송
                </ConfirmButton>
              </div>
            </form>
          ) : (
            <p className="muted">
              이 달에는 앱 출퇴근 기록이 없어서 보낼 수 없습니다. (앱 기록은 {firstDate ?? '-'}부터)
            </p>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>
            구글 시트가 연결되어 있어야 합니다. → <Link href="/admin/google-sheet">구글 시트 연결</Link>
          </p>
        </section>
      )}

      <p className="small muted">
        &quot;자동 퇴근&quot;은 실제 퇴근 시간과 다를 수 있으니 관리 화면에서 확인 후 정정하세요. 정규직은 휴게시간을
        따로 입력하지 않아 퇴근 − 출근 시간 그대로 합산됩니다.
      </p>
    </main>
  )
}
