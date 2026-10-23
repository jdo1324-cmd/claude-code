import 'server-only'
import { ATTENDANCE_SELECT, validBreak, type AttendanceRecord } from '@/lib/attendance'
import { PHASES, PHASE_LABEL, appliesOn, type ChecklistEntry, type ChecklistItem } from '@/lib/checklist'
import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type Alert = {
  date: string
  kind: '필수 업무 누락' | '퇴근 태그 누락' | '휴게시간 미입력' | '매출 보고서 미제출' | '사진 없는 완료'
  message: string
  people: string[] // 관련 직원 이름
  href: string
}

const kst = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`).getTime()

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00+09:00`)
  d.setUTCDate(d.getUTCDate() + n)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
}

// 최근 days일 동안 놓친 일을 찾아냄 (사장/관리자 권한 또는 서버 비밀 키 클라이언트)
export async function findAlerts(supabase: Supabase, today: string, days = 7): Promise<Alert[]> {
  const from = addDays(today, -(days - 1))
  const now = Date.now()

  const [att, items, entries, sales, profiles, photoIssues] = await Promise.all([
    supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT + ', profiles!attendance_user_id_fkey(full_name, employment_type)')
      .eq('status', 'valid')
      .gte('work_date', from)
      .lte('work_date', today),
    supabase.from('checklist_items').select('*'),
    supabase.from('checklist_entries').select('*').eq('status', 'valid').gte('work_date', from),
    supabase.from('sales_reports').select('work_date').eq('status', 'valid').gte('work_date', from),
    supabase.from('profiles').select('id, full_name'),
    supabase.rpc('checklist_photo_issues', { p_from: from }),
  ])

  const records = (att.data ?? []) as unknown as (AttendanceRecord & {
    profiles: { full_name: string; employment_type: 'full_time' | 'part_time' } | null
  })[]
  const allItems = (items.data ?? []) as ChecklistItem[]
  const done = (entries.data ?? []) as ChecklistEntry[]
  const salesDates = new Set(((sales.data ?? []) as { work_date: string }[]).map((s) => s.work_date))
  const names = Object.fromEntries(
    ((profiles.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  const alerts: Alert[] = []
  for (let date = from; date <= today; date = addDays(date, 1)) {
    const dayRecords = records.filter((r) => r.work_date === date)
    if (dayRecords.length === 0) continue // 근무 기록이 없는 날(휴무 등)은 건너뜀
    const nameOf = (r: (typeof dayRecords)[number]) => r.profiles?.full_name ?? '?'

    // 1) 오픈·미들·마감 필수 업무 누락 → 그 시간대 근무자에게 연결
    //    점검 시각: 오픈 12:00, 미들 17:00, 마감 21:30 (그날 하는 요일의 항목만)
    for (const phase of PHASES) {
      const deadline = kst(date, phase === 'open' ? '12:00' : phase === 'middle' ? '17:00' : '21:30')
      if (now < deadline) continue
      const missing = allItems.filter(
        (i) =>
          i.phase === phase &&
          i.is_required &&
          i.is_active &&
          i.frequency === 'daily' && // 주간·월간 항목은 체크리스트 미완료 알림에서 따로 안내
          appliesOn(i, date) &&
          !done.some((e) => e.item_id === i.id && e.work_date === date),
      )
      if (missing.length === 0) continue
      const shift = dayRecords.filter((r) =>
        phase === 'open'
          ? new Date(r.clock_in).getTime() <= kst(date, '11:30')
          : phase === 'middle'
            ? new Date(r.clock_in).getTime() <= kst(date, '16:00') &&
              (r.clock_out === null || r.auto_clock_out || new Date(r.clock_out).getTime() >= kst(date, '15:00'))
            : r.clock_out === null || r.auto_clock_out || new Date(r.clock_out).getTime() >= kst(date, '20:30'),
      )
      alerts.push({
        date,
        kind: '필수 업무 누락',
        message: `${PHASE_LABEL[phase].replace(' 업무', '')} 필수 업무 ${missing.length}개 미완료: ${missing.map((m) => m.title).join(', ')}`,
        people: shift.length ? shift.map(nameOf) : ['(그 시간 근무자 기록 없음)'],
        href: `/admin/checklists?date=${date}`,
      })
    }

    // 2) 퇴근 태그 누락 (자동 퇴근)
    const auto = dayRecords.filter((r) => r.auto_clock_out)
    if (auto.length) {
      alerts.push({
        date,
        kind: '퇴근 태그 누락',
        message: '퇴근 태그를 찍지 않아 21:00로 자동 퇴근 처리됨 — 실제 퇴근 시간 확인 필요',
        people: auto.map(nameOf),
        href: `/admin?date=${date}`,
      })
    }

    // 3) 아르바이트 휴게시간 미입력
    const noBreak = dayRecords.filter(
      (r) => r.profiles?.employment_type === 'part_time' && r.clock_out !== null && validBreak(r) === null,
    )
    if (noBreak.length) {
      alerts.push({
        date,
        kind: '휴게시간 미입력',
        message: '아르바이트 휴게시간이 입력되지 않음 (근무시간·급여 계산에 영향)',
        people: noBreak.map(nameOf),
        href: `/admin?date=${date}`,
      })
    }

    // 4) 매출 보고서 미제출
    if (!salesDates.has(date) && (date < today || now >= kst(date, '22:00'))) {
      const closers = dayRecords.filter(
        (r) => r.clock_out === null || r.auto_clock_out || new Date(r.clock_out).getTime() >= kst(date, '20:30'),
      )
      alerts.push({
        date,
        kind: '매출 보고서 미제출',
        message: '매출 정산 보고서가 제출되지 않음',
        people: closers.length ? closers.map(nameOf) : [],
        href: `/admin/checklists?date=${date}`,
      })
    }
  }

  // 5) 사진 항목인데 사진 없이(또는 파일이 사라진 채) 완료된 기록
  for (const p of (photoIssues.data ?? []) as {
    work_date: string
    item_title: string
    done_by: string
    problem: string
  }[]) {
    alerts.push({
      date: p.work_date,
      kind: '사진 없는 완료',
      message: `"${p.item_title}" ${p.problem}`,
      people: [names[p.done_by] ?? '?'],
      href: `/admin/checklists?date=${p.work_date}`,
    })
  }

  return alerts.sort((a, b) => b.date.localeCompare(a.date))
}
