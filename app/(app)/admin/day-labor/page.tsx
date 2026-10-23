import Link from 'next/link'
import { ConfirmButton } from '@/app/components/confirm-button'
import { isMonth } from '@/lib/attendance'
import { requireAdmin } from '@/lib/auth'
import { todayKST } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'
import { addDayLabor, sendDayLaborSheet, voidDayLabor } from './actions'

export const maxDuration = 120

type Entry = {
  id: number
  work_date: string
  worker_name: string
  hours: number
  daily_wage: number
  extra_pay: number
  note: string | null
  status: 'valid' | 'void'
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function DayLaborPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; ok?: string; error?: string }>
}) {
  const { month: monthParam, ok, error } = await searchParams
  await requireAdmin()
  const today = todayKST()
  const month = isMonth(monthParam) ? monthParam : today.slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const admin = createAdminClient()
  const [{ data }, { data: nameData }, { data: exportData }, { data: sheetData }] = await Promise.all([
    admin
      .from('day_labor_entries')
      .select('id, work_date, worker_name, hours, daily_wage, extra_pay, note, status')
      .gte('work_date', `${month}-01`)
      .lte('work_date', `${month}-${String(last).padStart(2, '0')}`)
      .order('work_date')
      .order('id'),
    admin
      .from('day_labor_entries')
      .select('worker_name')
      .eq('status', 'valid')
      .order('created_at', { ascending: false })
      .limit(200),
    admin
      .from('day_labor_sheet_exports')
      .select('sent_at')
      .eq('month', month)
      .order('sent_at', { ascending: false })
      .limit(1),
    admin.from('google_sheet_settings').select('webhook_url').eq('id', 1).maybeSingle(),
  ])
  const entries = (data ?? []) as Entry[]
  const valid = entries.filter((e) => e.status === 'valid')
  const names = [...new Set(((nameData ?? []) as { worker_name: string }[]).map((n) => n.worker_name))]
  const lastSent = (exportData ?? [])[0] as { sent_at: string } | undefined
  const sheetConnected = !!sheetData?.webhook_url
  const total = valid.reduce(
    (s, e) => ({ hours: s.hours + Number(e.hours), wage: s.wage + e.daily_wage, extra: s.extra + e.extra_pay }),
    { hours: 0, wage: 0, extra: 0 },
  )
  const byName = [...new Set(valid.map((e) => e.worker_name))].map((name) => {
    const mine = valid.filter((e) => e.worker_name === name)
    return {
      name,
      days: new Set(mine.map((e) => e.work_date)).size,
      hours: mine.reduce((s, e) => s + Number(e.hours), 0),
      pay: mine.reduce((s, e) => s + e.daily_wage + e.extra_pay, 0),
    }
  })

  return (
    <main>
      <div className="page-head">
        <h1>일용직</h1>
      </div>
      <p className="small muted">
        일용 근무자의 근무를 적어 두고, 손익계산서 &quot;{m}월 인건비&quot; 탭의 일용직 구역으로 보냅니다. 주민번호는
        앱에 저장하지 않고 입력할 때 시트에 바로 적습니다.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <section>
        <h2>근무 기록 추가</h2>
        <form action={addDayLabor} className="item-fields">
          <label>
            날짜
            <input
              type="date"
              name="work_date"
              required
              defaultValue={month === today.slice(0, 7) ? today : `${month}-01`}
            />
          </label>
          <label>
            이름
            <input name="worker_name" required list="day-labor-names" placeholder="예: 홍길동" />
          </label>
          <label>
            주민번호 (처음 한 번만)
            <input
              name="rrn"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={14}
              placeholder={sheetConnected ? '이미 시트에 있으면 비워 두세요' : '구글 시트 연결 후 입력 가능'}
              disabled={!sheetConnected}
            />
            <span className="small muted">앱에는 저장하지 않고 손익계산서 일용직 칸에 바로 적습니다.</span>
          </label>
          <label>
            근무시간 (시간)
            <input name="hours" required inputMode="decimal" defaultValue="10" placeholder="예: 10 또는 7.5" />
          </label>
          <label>
            일급 (원)
            <input name="daily_wage" required inputMode="numeric" defaultValue="130000" placeholder="예: 130,000" />
          </label>
          <label>
            추가근무 수당 (원)
            <input name="extra_pay" inputMode="numeric" placeholder="없으면 비워 두세요" />
          </label>
          <label>
            메모 (선택)
            <input name="note" placeholder="예: 행사 지원" />
          </label>
          <div>
            <button type="submit">추가</button>
          </div>
        </form>
        <datalist id="day-labor-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </section>

      <section>
        <div className="cal-head">
          <Link
            href={`/admin/day-labor?month=${shiftMonth(month, -1)}`}
            className="btn btn-secondary icon-btn"
            aria-label="이전 달"
          >
            ◀
          </Link>
          <h2 style={{ margin: 0 }}>
            {y}년 {m}월 기록
          </h2>
          <Link
            href={`/admin/day-labor?month=${shiftMonth(month, 1)}`}
            className="btn btn-secondary icon-btn"
            aria-label="다음 달"
          >
            ▶
          </Link>
        </div>

        <div className="grid">
          <div className="card">
            <div className="stat-label">근무 {valid.length}건</div>
            <div className="big-number">{total.hours}시간</div>
          </div>
          <div className="card">
            <div className="stat-label">일급 합계 + 추가근무 수당</div>
            <div className="big-number">{won(total.wage + total.extra)}</div>
            <div className="small muted">
              일급 {won(total.wage)} · 추가 {won(total.extra)}
            </div>
          </div>
        </div>

        {byName.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th className="num">근무일</th>
                  <th className="num">근무시간</th>
                  <th className="num">지급 합계</th>
                </tr>
              </thead>
              <tbody>
                {byName.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className="num">{p.days}일</td>
                    <td className="num">{p.hours}시간</td>
                    <td className="num">{won(p.pay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>이름</th>
                <th className="num">근무시간</th>
                <th className="num">일급</th>
                <th className="num">추가근무 수당</th>
                <th>메모</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className={e.status === 'void' ? 'void-row' : undefined}>
                  <td>{e.work_date.slice(5)}</td>
                  <td>{e.worker_name}</td>
                  <td className="num">{Number(e.hours)}시간</td>
                  <td className="num">{won(e.daily_wage)}</td>
                  <td className="num">{e.extra_pay ? won(e.extra_pay) : '-'}</td>
                  <td className="small">{e.note ?? ''}</td>
                  <td className="keep">
                    {e.status === 'valid' ? (
                      <form action={voidDayLabor}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="month" value={month} />
                        <ConfirmButton message={`${e.work_date} ${e.worker_name} 기록을 지울까요?`}>
                          지우기
                        </ConfirmButton>
                      </form>
                    ) : (
                      <span className="badge">지움</span>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7}>이 달에는 기록이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>손익계산서로 전송</h2>
          {lastSent && <span className="badge badge-ok">마지막 전송 {lastSent.sent_at.slice(0, 10)}</span>}
        </div>
        <p className="small muted">
          손익계산서 &quot;{m}월 인건비&quot; 탭의 <strong>일용직 구역(&quot;성함&quot; 줄 아래)</strong>에서 이름이
          같은 줄을 찾아 날짜 칸에 근무시간을 넣습니다. 시트에 없는 이름은 빈 줄에 추가합니다. 앱에서 지운 기록의 칸은
          비웁니다. 수식 칸은 건드리지 않습니다. 기록을 추가하거나 지우면 자동으로 반영되고, 이 버튼은 시트를 앱 기록과
          다시 맞출 때 씁니다.
        </p>
        {sheetConnected ? (
          <form action={sendDayLaborSheet}>
            <input type="hidden" name="month" value={month} />
            <ConfirmButton message={`${m}월 일용직 기록 ${valid.length}건을 손익계산서로 보낼까요?`}>
              📤 {m}월 기록 손익계산서로 다시 보내기
            </ConfirmButton>
          </form>
        ) : (
          <p className="alert alert-warn small">
            구글 시트가 아직 연결되지 않았습니다. 사장님이 <Link href="/admin/google-sheet">구글 시트 연결</Link>을 먼저
            해 주세요.
          </p>
        )}
      </section>
    </main>
  )
}
