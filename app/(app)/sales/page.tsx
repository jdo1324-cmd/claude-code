import Link from 'next/link'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import { getCurrentProfile, isAdmin } from '@/lib/auth'
import { formatTime, todayKST } from '@/lib/format'
import { SALES_SELECT, formatWon, paymentDiff, type SalesReport } from '@/lib/sales'
import { createClient } from '@/lib/supabase/server'
import { SalesForm } from './sales-form'

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; rewrite?: string }>
}) {
  const { error, ok, rewrite } = await searchParams
  const me = await getCurrentProfile()
  const date = todayKST()
  const supabase = await createClient()

  const [
    { data: missingData },
    { data: reportData },
    { data: statusData },
    { data: nameData },
    { data: posEntryData },
  ] = await Promise.all([
    supabase.rpc('missing_required_close_items', { p_date: date }),
    // 금액: 사장/관리자와 제출한 본인만 조회됨 (DB 권한)
    supabase.from('sales_reports').select(SALES_SELECT).eq('work_date', date).eq('status', 'valid').maybeSingle(),
    // 제출 여부: 모든 직원
    supabase.rpc('sales_report_status', { p_date: date }),
    supabase.rpc('member_names'),
    // 마감 체크리스트에 입력된 오늘 "포스 매출 마감 금액" → 총 매출 칸 미리 채우기
    supabase
      .from('checklist_entries')
      .select('value_number, checklist_items!inner(title)')
      .eq('work_date', date)
      .eq('status', 'valid')
      .eq('checklist_items.title', '포스 매출 마감 금액')
      .maybeSingle(),
  ])
  const posTotal = (posEntryData as { value_number: number | null } | null)?.value_number ?? null
  const missing = (missingData ?? []) as { id: number; category: string; title: string }[]
  const report = reportData as unknown as SalesReport | null
  const status = ((statusData ?? []) as { submitted_by: string; submitted_at: string }[])[0] ?? null
  const names = Object.fromEntries(((nameData ?? []) as { id: string; full_name: string }[]).map((n) => [n.id, n.full_name]))
  const canRewrite = !!report && (isAdmin(me.role) || report.submitted_by === me.id)
  const blocked = missing.length > 0

  return (
    <main>
      {/* 체크리스트가 완료되면 저장 가능 상태로 바로 바뀜 */}
      <RealtimeRefresh table="checklist_entries" filter={`work_date=eq.${date}`} />
      <h1>매출 정산 보고서 ({date})</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {ok && <p style={{ color: 'green' }}>{ok}</p>}

      {blocked && (
        <div style={{ background: '#fee', border: '2px solid crimson', padding: 12, marginBottom: 12 }}>
          <strong>마감 필수 체크리스트를 먼저 모두 끝내야 보고서를 저장할 수 있습니다.</strong>
          <ul>
            {missing.map((m) => (
              <li key={m.id}>
                {m.category} — {m.title}
              </li>
            ))}
          </ul>
          <Link href="/checklist">▶ 체크리스트로 가기</Link>
        </div>
      )}

      {status ? (
        <>
          <section style={{ border: '1px solid green', padding: 12 }}>
            <h2>✅ 오늘 보고서 제출 완료</h2>
            <p>
              {names[status.submitted_by] ?? '?'} · {formatTime(status.submitted_at)} 제출
            </p>
            {report ? (
              <ul>
                <li>매출: {formatWon(report.total_sales)}</li>
                <li>
                  카드 {formatWon(report.card_amount)} · 현금 {formatWon(report.cash_amount)} · 기타{' '}
                  {formatWon(report.other_amount)}
                </li>
                {paymentDiff(report) !== 0 && (
                  <li style={{ color: 'crimson', fontWeight: 'bold' }}>
                    ⚠️ 결제수단 합계와 매출 차이: {formatWon(paymentDiff(report))}
                  </li>
                )}
                <li>
                  현금 지출 {formatWon(report.cash_expense)} · 체크카드 지출 {formatWon(report.check_card_expense)}
                </li>
                {report.note && <li>메모: {report.note}</li>}
              </ul>
            ) : (
              <p>금액은 제출한 사람과 사장님·관리자만 볼 수 있습니다.</p>
            )}
            {canRewrite && !rewrite && (
              <p>
                <Link href="/sales?rewrite=1">잘못 입력했다면 다시 작성</Link> (이전 보고서는 &quot;무효&quot;로
                남습니다)
              </p>
            )}
          </section>
          {canRewrite && rewrite && (
            <>
              <h2>보고서 다시 작성</h2>
              <SalesForm blocked={blocked} replace initialTotal={posTotal} />
            </>
          )}
        </>
      ) : (
        <SalesForm blocked={blocked} replace={false} initialTotal={posTotal} />
      )}
    </main>
  )
}
