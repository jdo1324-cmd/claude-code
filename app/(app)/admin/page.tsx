import Link from 'next/link'
import { headers } from 'next/headers'
import { ConfirmButton } from '@/app/components/confirm-button'
import {
  ATTENDANCE_SELECT,
  ATTENDANCE_WITH_PROFILE_SELECT,
  BREAK_OPTIONS,
  SOURCE_LABEL,
  breakLabel,
  formatMinutes,
  netMinutes,
  validBreak,
  type AttendanceRecord,
  type AttendanceWithProfile,
} from '@/lib/attendance'
import { requireAdmin, type Profile } from '@/lib/auth'
import { getNfcToken } from '@/lib/clock'
import { CORRECTION_SELECT, REQUEST_TYPE_LABEL, type CorrectionRequest } from '@/lib/corrections'
import { createClient } from '@/lib/supabase/server'
import { EMPLOYMENT_LABEL, ROLE_LABEL, formatTime, toKstInput, todayKST } from '@/lib/format'
import {
  addAttendance,
  correctAttendance,
  createEmployee,
  regenerateNfcToken,
  resetEmployeePassword,
  reviewCorrection,
  setBreak,
  updateEmployee,
  voidAttendance,
} from './actions'

const section = { borderTop: '1px solid #ccc', marginTop: 24, paddingTop: 8 }
const box = { border: '1px solid #ccc', padding: 8, margin: '4px 0' }

function BreakSelect({ name = 'minutes', required = false }: { name?: string; required?: boolean }) {
  return (
    <select name={name} defaultValue="" required={required}>
      <option value="" disabled={required}>
        {required ? '선택' : '변경 없음'}
      </option>
      {BREAK_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {breakLabel(m)}
        </option>
      ))}
    </select>
  )
}

function describeRecord(r: AttendanceRecord | undefined) {
  if (!r) return '-'
  const brk = validBreak(r)
  return `${r.work_date} 출근 ${formatTime(r.clock_in)} · 퇴근 ${formatTime(r.clock_out)}${
    brk === null ? '' : ` · 휴게 ${breakLabel(brk)}`
  }`
}

function describeProposal(q: CorrectionRequest) {
  if (q.request_type === 'void') return '무효 처리'
  return `출근 ${formatTime(q.proposed_clock_in)} · 퇴근 ${formatTime(q.proposed_clock_out)}${
    q.proposed_break_minutes === null ? '' : ` · 휴게 ${breakLabel(q.proposed_break_minutes)}`
  }`
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; date?: string }>
}) {
  const { error, ok, date: dateParam } = await searchParams
  const me = await requireAdmin()
  const isOwner = me.role === 'owner'
  const supabase = await createClient()
  const today = todayKST()
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today

  // 선택한 날짜 기록(무효 포함) + (오늘이면) 이전 날짜에 퇴근이 안 된 기록
  const attendanceFilter =
    date === today ? `work_date.eq.${date},and(clock_out.is.null,status.eq.valid)` : `work_date.eq.${date}`
  const [{ data: attendanceData, error: attendanceError }, { data: profileData }, { data: requestData }] =
    await Promise.all([
      supabase
        .from('attendance')
        .select(ATTENDANCE_WITH_PROFILE_SELECT)
        .or(attendanceFilter)
        .order('clock_in', { ascending: true }),
      supabase.from('profiles').select('*').order('created_at', { ascending: true }),
      supabase
        .from('correction_requests')
        .select(CORRECTION_SELECT)
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ])

  const attendance = (attendanceData ?? []) as unknown as AttendanceWithProfile[]
  const employees = (profileData ?? []) as Profile[]
  const requests = (requestData ?? []) as unknown as CorrectionRequest[]
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.full_name ?? '?'
  const isPartTimer = (id: string) => employees.find((e) => e.id === id)?.employment_type === 'part_time'
  const canManage = (userId: string) => isOwner || userId !== me.id

  // 정정 요청이 가리키는 원래 기록
  const requestRecordIds = requests.map((q) => q.attendance_id).filter((id): id is number => id !== null)
  const { data: requestRecordData } = requestRecordIds.length
    ? await supabase.from('attendance').select(ATTENDANCE_SELECT).in('id', requestRecordIds)
    : { data: [] }
  const requestRecords = (requestRecordData ?? []) as unknown as AttendanceRecord[]

  return (
    <main>
      <h1>관리</h1>
      <p>
        <Link href="/admin/hours">▶ 월별 근무시간 보기</Link>
      </p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {ok && <p style={{ color: 'green' }}>{ok}</p>}
      {attendanceError && <p style={{ color: 'crimson' }}>기록을 불러오지 못했습니다: {attendanceError.message}</p>}

      {/* ---------------- 정정 요청 ---------------- */}
      <section>
        <h2>정정 요청 ({requests.length}건 대기)</h2>
        {!isOwner && <p>관리자는 본인 요청을 처리할 수 없습니다. 사장님이 처리합니다.</p>}
        <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>직원</th>
              <th>종류</th>
              <th>원래 기록</th>
              <th>요청 내용</th>
              <th>사유</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((q) => (
              <tr key={q.id}>
                <td>{nameOf(q.user_id)}</td>
                <td>{REQUEST_TYPE_LABEL[q.request_type]}</td>
                <td>{describeRecord(requestRecords.find((r) => r.id === q.attendance_id))}</td>
                <td>{describeProposal(q)}</td>
                <td>{q.reason}</td>
                <td>
                  {canManage(q.user_id) ? (
                    <form action={reviewCorrection}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="date" value={date} />
                      <input name="note" placeholder="메모 (선택)" size={14} />{' '}
                      <button type="submit" name="decision" value="approve">
                        승인
                      </button>{' '}
                      <button type="submit" name="decision" value="reject">
                        거절
                      </button>
                    </form>
                  ) : (
                    '사장님 처리'
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6}>대기 중인 요청이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ---------------- 출퇴근 기록 ---------------- */}
      <section style={section}>
        <h2>출퇴근 기록</h2>
        <form method="get" style={{ marginBottom: 8 }}>
          <input type="date" name="date" defaultValue={date} /> <button type="submit">보기</button>
        </form>
        <p>
          기록은 직접 고칠 수 없습니다. [정정]을 하면 원래 기록은 &quot;무효&quot;로 남고 새 기록이 추가됩니다. 모든
          처리에는 사유가 필요합니다.{!isOwner && ' 관리자는 본인 기록을 처리할 수 없습니다.'}
        </p>
        <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>이름</th>
              <th>구분</th>
              <th>출근</th>
              <th>퇴근</th>
              <th>휴게</th>
              <th>실근무</th>
              <th>상태</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((r) => {
              const isVoid = r.status === 'void'
              const partTime = r.profiles?.employment_type === 'part_time'
              const brk = validBreak(r)
              const net = netMinutes(r)
              const voidBreaks = r.attendance_breaks.filter((b) => b.status === 'void')
              return (
                <tr
                  key={r.id}
                  style={
                    isVoid ? { color: '#999' } : r.work_date !== date ? { background: '#fee' } : undefined
                  }
                >
                  <td>
                    {r.profiles?.full_name}
                    {!isVoid && r.work_date !== date && ` (${r.work_date} 퇴근 안 됨)`}
                  </td>
                  <td>{r.profiles ? EMPLOYMENT_LABEL[r.profiles.employment_type] : ''}</td>
                  <td>{formatTime(r.clock_in)}</td>
                  <td>
                    {formatTime(r.clock_out)}
                    {r.auto_clock_out && ' (자동 퇴근 처리)'}
                  </td>
                  <td>
                    {partTime ? (brk === null ? <strong style={{ color: 'crimson' }}>미입력</strong> : breakLabel(brk)) : '-'}
                    {voidBreaks.map((b) => (
                      <div key={b.id} style={{ fontSize: 12, color: '#999' }}>
                        이전 {breakLabel(b.minutes)} → 변경 ({b.void_reason})
                      </div>
                    ))}
                  </td>
                  <td>{isVoid ? '-' : net === null ? '근무 중' : formatMinutes(net)}</td>
                  <td>
                    {isVoid ? `무효 (${r.void_reason ?? ''})` : `유효 · ${SOURCE_LABEL[r.source]}`}
                  </td>
                  <td>
                    {!isVoid && canManage(r.user_id) && (
                      <details>
                        <summary>정정 / 무효{partTime && ' / 휴게'}</summary>
                        <form action={correctAttendance} style={box}>
                          <strong>정정 (무효 + 새 기록)</strong>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="date" value={date} />
                          <div>
                            출근{' '}
                            <input type="datetime-local" name="clock_in" required defaultValue={toKstInput(r.clock_in)} />
                          </div>
                          <div>
                            퇴근 <input type="datetime-local" name="clock_out" defaultValue={toKstInput(r.clock_out)} />
                          </div>
                          {partTime && (
                            <div>
                              휴게 <BreakSelect />
                            </div>
                          )}
                          <div>
                            사유 <input name="reason" required size={20} />
                          </div>
                          <ConfirmButton message="원래 기록을 무효로 하고 새 기록을 추가합니다. 진행할까요?">
                            정정
                          </ConfirmButton>
                        </form>
                        {partTime && (
                          <form action={setBreak} style={box}>
                            <strong>휴게시간만 변경</strong>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="date" value={date} />
                            <div>
                              <BreakSelect required /> 사유 <input name="reason" required size={14} />
                            </div>
                            <ConfirmButton message="휴게시간을 {value}(으)로 변경합니다. 이전 값은 기록에 남습니다. 진행할까요?">
                              변경
                            </ConfirmButton>
                          </form>
                        )}
                        <form action={voidAttendance} style={box}>
                          <strong>무효 처리</strong>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="date" value={date} />
                          <div>
                            사유 <input name="reason" required size={20} />
                          </div>
                          <ConfirmButton message="이 기록을 무효 처리합니다. (기록은 지워지지 않고 무효로 남습니다) 진행할까요?">
                            무효 처리
                          </ConfirmButton>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              )
            })}
            {attendance.length === 0 && (
              <tr>
                <td colSpan={8}>기록이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>

        <h3>기록 추가 (태그를 못 찍은 날)</h3>
        <form action={addAttendance}>
          <input type="hidden" name="date" value={date} />
          <select name="user_id" required defaultValue="">
            <option value="" disabled>
              직원 선택
            </option>
            {employees
              .filter((e) => e.is_active && canManage(e.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                  {isPartTimer(e.id) && ' (아르바이트)'}
                </option>
              ))}
          </select>{' '}
          출근 <input type="datetime-local" name="clock_in" required defaultValue={`${date}T11:00`} /> 퇴근{' '}
          <input type="datetime-local" name="clock_out" required /> 휴게(아르바이트) <BreakSelect /> 사유{' '}
          <input name="reason" required size={16} />{' '}
          <ConfirmButton message="이 기록을 추가할까요?">추가</ConfirmButton>
        </form>
      </section>

      {/* ---------------- 직원 목록 ---------------- */}
      <section style={section}>
        <h2>직원 목록</h2>
        <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>권한</th>
              <th>고용 형태</th>
              <th>상태</th>
              {isOwner && <th></th>}
              {isOwner && <th>비밀번호 초기화</th>}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) =>
              isOwner && e.id !== me.id ? (
                <tr key={e.id}>
                  <td>{e.full_name}</td>
                  <td>{e.email}</td>
                  <td>
                    <select name="role" defaultValue={e.role} form={`emp-${e.id}`}>
                      <option value="staff">{ROLE_LABEL.staff}</option>
                      <option value="manager">{ROLE_LABEL.manager}</option>
                      <option value="owner">{ROLE_LABEL.owner}</option>
                    </select>
                  </td>
                  <td>
                    <select name="employment_type" defaultValue={e.employment_type} form={`emp-${e.id}`}>
                      <option value="full_time">{EMPLOYMENT_LABEL.full_time}</option>
                      <option value="part_time">{EMPLOYMENT_LABEL.part_time}</option>
                    </select>
                  </td>
                  <td>
                    <label>
                      <input type="checkbox" name="is_active" defaultChecked={e.is_active} form={`emp-${e.id}`} />{' '}
                      사용 중
                    </label>
                  </td>
                  <td>
                    <form id={`emp-${e.id}`} action={updateEmployee}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit">저장</button>
                    </form>
                  </td>
                  <td>
                    <form action={resetEmployeePassword}>
                      <input type="hidden" name="id" value={e.id} />
                      <input
                        name="password"
                        type="text"
                        minLength={8}
                        required
                        placeholder="새 임시 비밀번호"
                        autoComplete="off"
                        size={14}
                      />{' '}
                      <button type="submit">초기화</button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td>{e.full_name}</td>
                  <td>{e.email}</td>
                  <td>{ROLE_LABEL[e.role]}</td>
                  <td>{EMPLOYMENT_LABEL[e.employment_type]}</td>
                  <td>{e.is_active ? '사용 중' : '중지'}</td>
                  {isOwner && <td>{e.id === me.id ? '(본인)' : ''}</td>}
                  {isOwner && <td></td>}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>

      {isOwner && <OwnerSections />}
    </main>
  )
}

// 사장만 보는 영역: NFC / 계정 만들기
async function OwnerSections() {
  const [nfcToken, h] = await Promise.all([getNfcToken(), headers()])
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`
  const nfcUrl = `${origin}/nfc?t=${nfcToken}`

  return (
    <>
      <section style={section}>
        <h2>NFC 태그</h2>
        <p>
          아래 주소를 NFC 태그에 써서 매장 입구에 붙이세요. 출퇴근은 이 태그로만 할 수 있습니다. 직원이 태그를 못
          찍었다면 위 &quot;기록 추가&quot;로 넣어 주세요.
        </p>
        <p>
          <code style={{ wordBreak: 'break-all' }}>{nfcUrl}</code>
        </p>
        <form action={regenerateNfcToken}>
          <button type="submit">NFC 코드 새로 만들기 (기존 태그는 사용 불가)</button>
        </form>
        <p style={{ fontSize: 13 }}>
          이 주소가 직원 단톡방 등에 퍼졌다면 새로 만들고 태그를 다시 쓰세요.
        </p>
      </section>

      <section style={section}>
        <h2>직원 계정 만들기</h2>
        <p>직원 한 명당 계정 하나씩, 본인 이메일로 만드세요. 임시 비밀번호를 알려주고 첫 로그인 후 바꾸게 하세요.</p>
        <form action={createEmployee}>
          <p>
            <label>
              이름 <input name="full_name" required />
            </label>
          </p>
          <p>
            <label>
              이메일 <input name="email" type="email" required />
            </label>
          </p>
          <p>
            <label>
              임시 비밀번호 (8자 이상) <input name="password" type="text" minLength={8} required autoComplete="off" />
            </label>
          </p>
          <p>
            <label>
              권한{' '}
              <select name="role" defaultValue="staff">
                <option value="staff">{ROLE_LABEL.staff}</option>
                <option value="manager">{ROLE_LABEL.manager}</option>
              </select>
            </label>{' '}
            <label>
              고용 형태{' '}
              <select name="employment_type" defaultValue="full_time">
                <option value="full_time">{EMPLOYMENT_LABEL.full_time}</option>
                <option value="part_time">{EMPLOYMENT_LABEL.part_time}</option>
              </select>
            </label>
          </p>
          <button type="submit">계정 만들기</button>
        </form>
      </section>
    </>
  )
}
