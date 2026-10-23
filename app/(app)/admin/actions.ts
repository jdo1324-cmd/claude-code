'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin, requireOwner, type EmploymentType, type Role } from '@/lib/auth'
import { fromKstInput } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const ROLES: Role[] = ['owner', 'manager', 'staff']
const EMPLOYMENT_TYPES: EmploymentType[] = ['full_time', 'part_time']

function back(params: { error?: string; ok?: string; date?: string }): never {
  revalidatePath('/admin')
  revalidatePath('/')
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
  redirect('/admin?' + new URLSearchParams(clean).toString())
}

// ================= 직원 계정 (사장 전용) =================

export async function createEmployee(formData: FormData) {
  await requireOwner()

  const fullName = String(formData.get('full_name') ?? '').trim()
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const password = String(formData.get('password') ?? '')
  const role = String(formData.get('role')) as Role
  const employmentType = String(formData.get('employment_type')) as EmploymentType

  if (!fullName || !email) back({ error: '이름과 이메일을 입력하세요.' })
  if (password.length < 8) back({ error: '임시 비밀번호는 8자 이상이어야 합니다.' })
  if (!ROLES.includes(role) || !EMPLOYMENT_TYPES.includes(employmentType)) back({ error: '잘못된 값입니다.' })

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) back({ error: `계정 생성 실패: ${error?.message ?? '알 수 없는 오류'}` })

  // 프로필 행은 DB 트리거가 만들어 둠 → 권한/고용 형태만 설정
  const { error: profileError } = await admin
    .from('profiles')
    .update({ full_name: fullName, role, employment_type: employmentType })
    .eq('id', data.user.id)
  if (profileError) back({ error: `권한 설정 실패: ${profileError.message}` })

  back({ ok: `${fullName} 계정을 만들었습니다.` })
}

export async function updateEmployee(formData: FormData) {
  const me = await requireOwner()

  const id = String(formData.get('id') ?? '')
  const role = String(formData.get('role')) as Role
  const employmentType = String(formData.get('employment_type')) as EmploymentType
  const isActive = formData.get('is_active') === 'on'

  if (!id || id === me.id) back({ error: '본인 계정은 여기서 바꿀 수 없습니다.' })
  if (!ROLES.includes(role) || !EMPLOYMENT_TYPES.includes(employmentType)) back({ error: '잘못된 값입니다.' })

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ role, employment_type: employmentType, is_active: isActive })
    .eq('id', id)
  if (error) back({ error: error.message })

  // 사용 중지된 직원은 로그인 자체를 막음 (기록은 남음)
  const { error: banError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: isActive ? 'none' : '876000h',
  })
  if (banError) back({ error: `로그인 차단 설정 실패: ${banError.message}` })

  back({ ok: '저장했습니다.' })
}

// 직원이 비밀번호를 잊었을 때: 사장이 임시 비밀번호로 초기화
export async function resetEmployeePassword(formData: FormData) {
  const me = await requireOwner()

  const id = String(formData.get('id') ?? '')
  const password = String(formData.get('password') ?? '')

  if (!id || id === me.id) back({ error: '본인 비밀번호는 "내 비밀번호 변경" 메뉴에서 바꾸세요.' })
  if (password.length < 8) back({ error: '임시 비밀번호는 8자 이상이어야 합니다.' })

  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password })
  if (error) back({ error: `비밀번호 초기화 실패: ${error.message}` })

  back({ ok: '임시 비밀번호로 초기화했습니다. 직원에게 알려주고 로그인 후 바꾸게 하세요.' })
}

// ================= 출퇴근 기록 (사장 = 전원, 관리자 = 본인 제외) =================
// 기록은 절대 직접 고치지 않음: DB 함수가 원래 기록을 "무효"로 표시하고 새 기록을 추가.
// 로그인한 사람 권한으로 호출 → DB가 사장/관리자 여부와 본인 기록 여부를 최종 확인.

function parseTimes(formData: FormData, date: string) {
  const rawIn = String(formData.get('clock_in') ?? '')
  const rawOut = String(formData.get('clock_out') ?? '')
  const clockIn = rawIn ? fromKstInput(rawIn) : null
  const clockOut = rawOut ? fromKstInput(rawOut) : null
  if ((rawIn && !clockIn) || (rawOut && !clockOut)) back({ error: '시간 형식이 잘못되었습니다.', date })
  return { clockIn, clockOut }
}

function optionalMinutes(value: FormDataEntryValue | null) {
  const raw = String(value ?? '')
  return raw === '' ? null : Number(raw)
}

export async function reviewCorrection(formData: FormData) {
  await requireAdmin()
  const date = String(formData.get('date') ?? '')
  const approve = formData.get('decision') === 'approve'

  const supabase = await createClient()
  const { error } = await supabase.rpc('review_correction', {
    p_request_id: Number(formData.get('id')),
    p_approve: approve,
    p_note: String(formData.get('note') ?? ''),
  })
  if (error) back({ error: `처리 실패: ${error.message}`, date })
  back({ ok: approve ? '승인했습니다. 원래 기록은 무효로 남고 새 기록이 추가되었습니다.' : '거절했습니다.', date })
}

export async function correctAttendance(formData: FormData) {
  await requireAdmin()
  const date = String(formData.get('date') ?? '')
  const { clockIn, clockOut } = parseTimes(formData, date)

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_correct_attendance', {
    p_attendance_id: Number(formData.get('id')),
    p_clock_in: clockIn,
    p_clock_out: clockOut,
    p_break_minutes: optionalMinutes(formData.get('minutes')),
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back({ error: `정정 실패: ${error.message}`, date })
  back({ ok: '정정했습니다. 원래 기록은 무효로 남고 새 기록이 추가되었습니다.', date })
}

export async function addAttendance(formData: FormData) {
  await requireAdmin()
  const date = String(formData.get('date') ?? '')
  const { clockIn, clockOut } = parseTimes(formData, date)

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_add_attendance', {
    p_user_id: String(formData.get('user_id') ?? ''),
    p_clock_in: clockIn,
    p_clock_out: clockOut,
    p_break_minutes: optionalMinutes(formData.get('minutes')),
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back({ error: `추가 실패: ${error.message}`, date })
  back({ ok: '출퇴근 기록을 추가했습니다.', date })
}

export async function voidAttendance(formData: FormData) {
  await requireAdmin()
  const date = String(formData.get('date') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_void_attendance', {
    p_attendance_id: Number(formData.get('id')),
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back({ error: `무효 처리 실패: ${error.message}`, date })
  back({ ok: '무효 처리했습니다. 기록은 지워지지 않고 "무효"로 남습니다.', date })
}

export async function setBreak(formData: FormData) {
  await requireAdmin()
  const date = String(formData.get('date') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_break', {
    p_attendance_id: Number(formData.get('id')),
    p_minutes: optionalMinutes(formData.get('minutes')),
    p_reason: String(formData.get('reason') ?? ''),
  })
  if (error) back({ error: `휴게시간 변경 실패: ${error.message}`, date })
  back({ ok: '휴게시간을 변경했습니다. 이전 값은 무효로 기록에 남습니다.', date })
}

// ================= NFC 설정 (사장 전용) =================

export async function regenerateNfcToken() {
  await requireOwner()
  const { error } = await createAdminClient()
    .from('store_settings')
    .update({ nfc_token: randomBytes(18).toString('hex'), updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) back({ error: `설정 저장 실패: ${error.message}` })
  back({ ok: 'NFC 코드를 새로 만들었습니다. 매장 NFC 태그에 새 주소를 다시 써 주세요.' })
}
