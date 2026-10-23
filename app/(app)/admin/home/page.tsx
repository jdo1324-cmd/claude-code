import Link from 'next/link'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import { findAlerts } from '@/lib/alerts'
import { requireAdmin, type Profile } from '@/lib/auth'
import { PHASES, PHASE_LABEL, loadChecklist, progress } from '@/lib/checklist'
import { formatTime, todayKST } from '@/lib/format'
import { SALES_SELECT, formatWon, paymentDiff, type SalesReport } from '@/lib/sales'
import { createClient } from '@/lib/supabase/server'
import { PushSetup } from './push-setup'

export default async function AdminHomePage() {
  const me = await requireAdmin()
  const today = todayKST()
  const supabase = await createClient()

  const [
    { data: salesData },
    { data: attData },
    { data: profileData },
    { count: correctionCount },
    { count: receiptCount },
    checklist,
    alerts,
  ] = await Promise.all([
    supabase.from('sales_reports').select(SALES_SELECT).eq('work_date', today).eq('status', 'valid').maybeSingle(),
    supabase
      .from('attendance')
      .select('user_id, clock_in, clock_out, auto_clock_out')
      .eq('status', 'valid')
      .or(`work_date.eq.${today},clock_out.is.null`),
    supabase.from('profiles').select('*'),
    supabase.from('correction_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .in('status', ['processing', 'proposed', 'failed']),
    loadChecklist(supabase, today),
    findAlerts(supabase, today, 7),
  ])

  const report = salesData as unknown as SalesReport | null
  const employees = (profileData ?? []) as Profile[]
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.full_name ?? '?'
  const att = (attData ?? []) as {
    user_id: string
    clock_in: string
    clock_out: string | null
    auto_clock_out: boolean
  }[]
  const working = att.filter((a) => a.clock_out === null)
  const workedToday = new Set(att.map((a) => a.user_id))
  const posEntry = checklist.entries.find(
    (e) => e.status === 'valid' && checklist.items.find((i) => i.id === e.item_id)?.title === '포스 매출 마감 금액',
  )
  const phaseProgress = PHASES.map((phase) => ({
    phase,
    p: progress(checklist.items, checklist.entries, phase),
  })).filter(({ p }) => p.allTotal > 0)
  const pendingTotal = (correctionCount ?? 0) + (receiptCount ?? 0)
  const todayAlerts = alerts.filter((a) => a.date === today)

  return (
    <main>
      <RealtimeRefresh table="checklist_entries" filter={`work_date=eq.${today}`} />
      <div className="page-head">
        <h1>{me.role === 'owner' ? '사장님' : '관리자'} 홈</h1>
        <span className="muted">{today}</span>
      </div>
      <PushSetup />

      <div className="grid">
        <section className="card">
          <div className="stat-label">오늘 매출</div>
          {report ? (
            <>
              <div className="big-number">{formatWon(report.total_sales)}</div>
              <div className="small">
                카드 {formatWon(report.card_amount)} · 현금 {formatWon(report.cash_amount)} · 기타{' '}
                {formatWon(report.other_amount)}
              </div>
              {paymentDiff(report) !== 0 && (
                <div className="small text-danger">⚠️ 결제수단 합계 차이 {formatWon(paymentDiff(report))}</div>
              )}
            </>
          ) : (
            <>
              <div className="big-number">
                {posEntry?.value_number != null ? formatWon(Number(posEntry.value_number)) : '-'}
              </div>
              <div className="small muted">
                {posEntry ? '체크리스트 포스 금액 (보고서 미제출)' : '아직 보고서 미제출'}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <div className="stat-label">근무 인원</div>
          <div className="big-number">지금 {working.length}명</div>
          <div className="small">
            {working.length > 0
              ? working.map((w) => `${nameOf(w.user_id)}(${formatTime(w.clock_in)}~)`).join(', ')
              : '근무 중인 직원 없음'}
          </div>
          <div className="small muted">
            오늘 출근 {workedToday.size}명 / 전체 직원 {employees.filter((e) => e.is_active).length}명
          </div>
        </section>

        <section className="card">
          <div className="stat-label">처리할 승인 요청</div>
          <div className="big-number" style={{ color: pendingTotal ? 'var(--danger)' : undefined }}>
            {pendingTotal}건
          </div>
          <div className="small">
            <Link href="/admin">정정 요청 {correctionCount ?? 0}건</Link> ·{' '}
            <Link href="/admin/receipts">전표 확인 {receiptCount ?? 0}건</Link>
          </div>
        </section>

        <section className="card">
          <div className="stat-label">오늘 체크리스트 (필수)</div>
          <div className="big-number" style={{ display: 'flex', flexDirection: 'column' }}>
            {phaseProgress.map(({ phase, p }) => (
              <span
                key={phase}
                style={{ color: p.requiredDone === p.requiredTotal ? 'var(--success)' : 'var(--danger)' }}
              >
                {PHASE_LABEL[phase].replace(' 업무', '')} {p.requiredDone}/{p.requiredTotal}
              </span>
            ))}
          </div>
          <div className="small">
            <Link href={`/admin/checklists?date=${today}`}>자세히 보기</Link>
          </div>
        </section>
      </div>

      <h2>
        자동 점검 — 확인이 필요한 일 <span className="small muted">(최근 7일)</span>
      </h2>
      {todayAlerts.length > 0 && <p className="alert alert-error">오늘 확인할 일 {todayAlerts.length}건</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>종류</th>
              <th>내용</th>
              <th>관련 직원</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a, i) => (
              <tr key={i} style={a.date === today ? { background: 'var(--danger-bg)' } : undefined}>
                <td>
                  <Link href={a.href}>{a.date}</Link>
                </td>
                <td>{a.kind}</td>
                <td>{a.message}</td>
                <td>{a.people.join(', ')}</td>
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={4}>최근 7일 동안 놓친 일이 없습니다. 👍</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ul className="small muted">
        <li>
          필수 업무 누락(매일 항목): 오픈은 12:00, 미들은 17:00, 마감은 21:30이 지나도 안 된 필수 항목. 그 시간대
          근무자를 함께 표시합니다.
        </li>
        <li>
          사진 없는 완료: 사진 항목인데 사진이 없거나 파일이 사라진 완료 기록 (앱에서는 사진 없이 완료할 수 없게 막혀
          있음).
        </li>
        <li>매장 밖 출퇴근 의심 기록 감지는 사장님 요청으로 보류 중입니다.</li>
      </ul>
    </main>
  )
}
