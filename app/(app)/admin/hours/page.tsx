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
import { requireAdmin, type Profile } from '@/lib/auth'
import { EMPLOYMENT_LABEL, ROLE_LABEL, todayKST } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

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

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: monthParam } = await searchParams
  await requireAdmin()
  const month = isMonth(monthParam) ? monthParam : todayKST().slice(0, 7)
  const { start, end } = monthRange(month)
  const supabase = await createClient()

  const [{ data: profileData }, { data: recordData, error }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('status', 'valid') // 무효 기록은 합계에서 제외
      .gte('work_date', start)
      .lte('work_date', end),
  ])
  const employees = (profileData ?? []) as Profile[]
  const records = (recordData ?? []) as unknown as AttendanceRecord[]

  const rows = employees
    .map((e) => ({ e, s: summarize(records.filter((r) => r.user_id === e.id), e.employment_type === 'part_time') }))
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
      {error && <p style={{ color: 'crimson' }}>기록을 불러오지 못했습니다: {error.message}</p>}
      <p>
        {month} ({start} ~ {end}) · 유효한 기록만 합산 · 실근무 = 퇴근 − 출근 − 휴게시간(아르바이트)
      </p>

      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
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
              <tr key={e.id} style={e.is_active ? undefined : { color: '#999' }}>
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
                <td style={{ color: warnings.length ? 'crimson' : undefined }}>{warnings.join(', ') || '-'}</td>
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
      <p style={{ fontSize: 13 }}>
        &quot;자동 퇴근&quot;은 실제 퇴근 시간과 다를 수 있으니 관리 화면에서 확인 후 정정하세요. 정규직은 휴게시간을
        따로 입력하지 않아 퇴근 − 출근 시간 그대로 합산됩니다.
      </p>
    </main>
  )
}
