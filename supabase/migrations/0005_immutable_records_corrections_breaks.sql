-- =========================================================
-- 0005: 기록 불변 + 정정 요청 + 휴게시간
--   - 확정된 출퇴근 기록은 절대 수정/삭제하지 않음. 바꿀 때는 "무효" 표시 + 새 기록 추가.
--   - 직원은 정정 요청 → 사장/관리자 승인.
--   - 아르바이트는 휴게시간(0.5시간 단위)을 한 번만 입력. 변경은 사장/관리자만 (이전 값은 무효로 남김).
--   - 출근/퇴근을 명시적으로 구분 (토글 X), 하루 1회 출근.
-- =========================================================

-- ---------- 이전 방식(직접 수정 + 수정 이력) 정리 ----------
drop trigger attendance_after_write on public.attendance;
drop function public.attendance_after_write();
drop table public.attendance_logs;
drop policy "attendance_update_admin" on public.attendance;
drop policy "attendance_insert_admin" on public.attendance;
drop function public.clock_toggle_for(uuid);
drop trigger attendance_before_write on public.attendance;
drop function public.attendance_before_write();
alter table public.attendance drop column edited_by, drop column edited_at;

-- ---------- 출퇴근 기록: 무효 표시 / 출처 / 대체 관계 ----------
alter table public.attendance
  add column status      text not null default 'valid' check (status in ('valid', 'void')),
  add column source      text not null default 'nfc' check (source in ('nfc', 'admin', 'correction')),
  add column created_by  uuid references public.profiles (id),   -- null = 직원 본인이 NFC로 기록
  add column replaces_id bigint references public.attendance (id),  -- 이 기록이 대체한 (무효 처리된) 기록
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.profiles (id),
  add column void_reason text;

drop index public.attendance_one_open_per_user;
create unique index attendance_one_open_per_user on public.attendance (user_id)
  where clock_out is null and status = 'valid';
-- 하루에 유효한 출퇴근 기록은 1건 (하루 두 번 출근 방지)
create unique index attendance_one_per_day on public.attendance (user_id, work_date)
  where status = 'valid';

-- 기록 보호: 추가 / "근무 중 → 퇴근" / "유효 → 무효" 만 허용. 그 외 수정·삭제는 DB가 거부.
create function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.work_date := (new.clock_in at time zone 'Asia/Seoul')::date;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception '출퇴근 기록은 삭제할 수 없습니다. 무효 처리하세요';
  end if;

  if old.status = 'void' then
    raise exception '무효 처리된 기록은 변경할 수 없습니다';
  end if;

  if new.user_id <> old.user_id or new.clock_in <> old.clock_in or new.work_date <> old.work_date
     or new.source <> old.source or new.created_by is distinct from old.created_by
     or new.replaces_id is distinct from old.replaces_id or new.created_at <> old.created_at then
    raise exception '확정된 출퇴근 기록은 수정할 수 없습니다. 정정 요청을 이용하세요';
  end if;

  -- 무효 처리
  if new.status = 'void' then
    if new.clock_out is distinct from old.clock_out or new.auto_clock_out <> old.auto_clock_out then
      raise exception '무효 처리할 때 다른 값은 바꿀 수 없습니다';
    end if;
    new.voided_at := coalesce(new.voided_at, now());
    return new;
  end if;

  -- 퇴근 (근무 중인 기록을 마감)
  if old.clock_out is null and new.clock_out is not null
     and new.voided_at is null and new.voided_by is null and new.void_reason is null then
    return new;
  end if;

  raise exception '확정된 출퇴근 기록은 수정할 수 없습니다. 정정 요청을 이용하세요';
end;
$$;

create trigger attendance_guard
  before insert or update or delete on public.attendance
  for each row execute function public.attendance_guard();

-- ---------- 휴게시간 ----------
create table public.attendance_breaks (
  id            bigint generated always as identity primary key,
  attendance_id bigint not null references public.attendance (id),
  minutes       int not null check (minutes between 0 and 480 and minutes % 30 = 0),
  entered_by    uuid not null references public.profiles (id),
  entered_at    timestamptz not null default now(),
  reason        text,                                -- 사장/관리자가 바꾼 이유
  status        text not null default 'valid' check (status in ('valid', 'void')),
  voided_at     timestamptz,
  voided_by     uuid references public.profiles (id),
  void_reason   text
);
create unique index attendance_breaks_one_valid on public.attendance_breaks (attendance_id) where status = 'valid';
alter table public.attendance_breaks enable row level security;

create policy "breaks_select_own_or_admin" on public.attendance_breaks
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.attendance a where a.id = attendance_id and a.user_id = auth.uid())
  );

-- ---------- 정정 요청 ----------
create table public.correction_requests (
  id                     bigint generated always as identity primary key,
  user_id                uuid not null references public.profiles (id),
  request_type           text not null check (request_type in ('modify', 'add', 'void')),
  attendance_id          bigint references public.attendance (id),
  proposed_clock_in      timestamptz,
  proposed_clock_out     timestamptz,
  proposed_break_minutes int check (proposed_break_minutes is null
                                    or (proposed_break_minutes between 0 and 480 and proposed_break_minutes % 30 = 0)),
  reason                 text not null,
  status                 text not null default 'pending'
                           check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at             timestamptz not null default now(),
  reviewed_by            uuid references public.profiles (id),
  reviewed_at            timestamptz,
  review_note            text,
  result_attendance_id   bigint references public.attendance (id)
);
create unique index correction_one_pending_per_record on public.correction_requests (attendance_id)
  where status = 'pending' and attendance_id is not null;
create index correction_requests_status_idx on public.correction_requests (status, created_at);
alter table public.correction_requests enable row level security;

create policy "corrections_select_own_or_admin" on public.correction_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 휴게시간/정정 요청도 삭제·임의 수정 금지 (상태 변경만)
create function public.append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '기록은 삭제할 수 없습니다';
  end if;

  if tg_table_name = 'attendance_breaks' then
    if old.status = 'valid' and new.status = 'void'
       and new.attendance_id = old.attendance_id and new.minutes = old.minutes
       and new.entered_by = old.entered_by and new.entered_at = old.entered_at then
      new.voided_at := coalesce(new.voided_at, now());
      return new;
    end if;
    raise exception '입력된 휴게시간은 수정할 수 없습니다';
  end if;

  -- correction_requests
  if old.status = 'pending' and new.status <> 'pending'
     and new.user_id = old.user_id and new.request_type = old.request_type
     and new.attendance_id is not distinct from old.attendance_id
     and new.proposed_clock_in is not distinct from old.proposed_clock_in
     and new.proposed_clock_out is not distinct from old.proposed_clock_out
     and new.proposed_break_minutes is not distinct from old.proposed_break_minutes
     and new.reason = old.reason and new.created_at = old.created_at then
    return new;
  end if;
  raise exception '처리된 정정 요청은 바꿀 수 없습니다';
end;
$$;

create trigger attendance_breaks_guard
  before update or delete on public.attendance_breaks
  for each row execute function public.append_only_guard();
create trigger correction_requests_guard
  before update or delete on public.correction_requests
  for each row execute function public.append_only_guard();

-- ---------- 공통 검사 ----------
create function public.assert_can_manage(p_target uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '사장 또는 관리자만 할 수 있습니다';
  end if;
  if public.my_role() = 'manager' and p_target = auth.uid() then
    raise exception '관리자는 본인 기록을 처리할 수 없습니다. 사장님께 요청하세요';
  end if;
end;
$$;

create function public.assert_valid_times(p_in timestamptz, p_out timestamptz, p_require_out boolean)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_in is null then
    raise exception '출근 시간을 입력하세요';
  end if;
  if p_require_out and p_out is null then
    raise exception '퇴근 시간을 입력하세요';
  end if;
  if p_out is not null and p_out <= p_in then
    raise exception '퇴근 시간은 출근 시간보다 늦어야 합니다';
  end if;
  if p_in > now() + interval '5 minutes' or p_out > now() + interval '5 minutes' then
    raise exception '미래 시간은 입력할 수 없습니다';
  end if;
  if p_out - p_in > interval '24 hours' then
    raise exception '근무시간이 24시간을 넘을 수 없습니다';
  end if;
end;
$$;

-- 기록 변경의 유일한 통로: 무효 + 새 기록 (내부 전용)
create function public.apply_attendance_change(
  p_kind          text,          -- modify / add / void
  p_attendance_id bigint,
  p_user_id       uuid,
  p_clock_in      timestamptz,
  p_clock_out     timestamptz,
  p_break_minutes int,
  p_reason        text,
  p_source        text           -- admin / correction
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    public.attendance;
  v_break  public.attendance_breaks;
  v_new_id bigint;
begin
  if p_kind in ('modify', 'void') then
    select * into v_old from public.attendance
    where id = p_attendance_id and status = 'valid'
    for update;
    if not found then
      raise exception '이미 무효 처리되었거나 없는 기록입니다';
    end if;

    update public.attendance
    set status = 'void', voided_by = auth.uid(), void_reason = p_reason
    where id = v_old.id;

    if p_kind = 'void' then
      return v_old.id;
    end if;
  end if;

  begin
    insert into public.attendance (user_id, clock_in, clock_out, source, created_by, replaces_id)
    values (coalesce(v_old.user_id, p_user_id), p_clock_in, p_clock_out, p_source, auth.uid(), v_old.id)
    returning id into v_new_id;
  exception when unique_violation then
    raise exception '그 날짜에 이미 유효한 출퇴근 기록(또는 근무 중 기록)이 있습니다';
  end;

  -- 휴게시간: 새로 지정했으면 그 값, 아니면 원래 기록의 휴게시간을 그대로 옮김
  if p_break_minutes is not null then
    insert into public.attendance_breaks (attendance_id, minutes, entered_by, reason)
    values (v_new_id, p_break_minutes, auth.uid(), p_reason);
  elsif v_old.id is not null then
    select * into v_break from public.attendance_breaks
    where attendance_id = v_old.id and status = 'valid';
    if found then
      insert into public.attendance_breaks (attendance_id, minutes, entered_by, reason)
      values (v_new_id, v_break.minutes, v_break.entered_by, '정정 시 기존 휴게시간 유지');
    end if;
  end if;

  return v_new_id;
end;
$$;

-- ---------- 자동 퇴근: 유효한 기록만 ----------
create or replace function public.run_auto_clock_out()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.attendance
  set clock_out = greatest(((work_date + time '21:00') at time zone 'Asia/Seoul'), clock_in + interval '1 second'),
      auto_clock_out = true
  where clock_out is null
    and status = 'valid'
    and now() >= ((work_date + time '21:30') at time zone 'Asia/Seoul');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- 출근 (NFC, 서버 전용) ----------
create function public.clock_in_for(p_user_id uuid)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.attendance;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception '비활성화된 계정입니다';
  end if;

  perform public.run_auto_clock_out();

  select * into v_row from public.attendance
  where user_id = p_user_id and status = 'valid' and clock_out is null;
  if found then
    raise exception '이미 출근 상태입니다 (출근 %)', to_char(v_row.clock_in at time zone 'Asia/Seoul', 'HH24:MI');
  end if;

  select * into v_row from public.attendance
  where user_id = p_user_id and status = 'valid' and work_date = v_today;
  if found then
    if v_row.auto_clock_out then
      raise exception '오늘은 21:00로 자동 퇴근 처리되었습니다. 실제 퇴근 시간은 정정 요청을 해 주세요';
    end if;
    raise exception '오늘은 이미 출퇴근 기록이 있습니다. 잘못된 경우 정정 요청을 해 주세요';
  end if;

  insert into public.attendance (user_id) values (p_user_id) returning * into v_row;
  return v_row;
exception when unique_violation then
  raise exception '이미 출근 처리되었습니다';
end;
$$;

-- ---------- 퇴근 (NFC, 서버 전용) ----------
create function public.clock_out_for(p_user_id uuid)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open  public.attendance;
  v_row   public.attendance;
  v_emp   public.employment_type;
  v_break int;
begin
  select employment_type into v_emp from public.profiles where id = p_user_id and is_active;
  if not found then
    raise exception '비활성화된 계정입니다';
  end if;

  perform public.run_auto_clock_out();

  select * into v_open from public.attendance
  where user_id = p_user_id and status = 'valid' and clock_out is null
  for update;
  if not found then
    raise exception '출근 기록이 없습니다. 이미 퇴근했거나 자동 퇴근 처리되었습니다';
  end if;

  if v_open.clock_in > now() - interval '10 minutes' then
    raise exception '출근 후 10분 안에는 퇴근할 수 없습니다. 잘못 찍었다면 정정 요청을 해 주세요';
  end if;

  if v_emp = 'part_time' then
    select minutes into v_break from public.attendance_breaks
    where attendance_id = v_open.id and status = 'valid';
    if not found then
      raise exception using errcode = 'BRK01', message = '휴게시간을 먼저 입력해야 퇴근할 수 있습니다';
    end if;
    if v_break * interval '1 minute' >= now() - v_open.clock_in then
      raise exception '휴게시간이 근무시간보다 깁니다. 사장님이나 관리자에게 휴게시간 수정을 요청하세요';
    end if;
  end if;

  update public.attendance set clock_out = now() where id = v_open.id returning * into v_row;
  return v_row;
end;
$$;

-- ---------- 휴게시간 입력 (아르바이트 본인, 1회) ----------
create function public.submit_break(p_attendance_id bigint, p_minutes int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.attendance;
begin
  select * into v_att from public.attendance where id = p_attendance_id and status = 'valid';
  if not found or v_att.user_id is distinct from auth.uid() then
    raise exception '본인의 출퇴근 기록에만 휴게시간을 입력할 수 있습니다';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active and employment_type = 'part_time') then
    raise exception '휴게시간 입력은 아르바이트 직원만 할 수 있습니다';
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 480 or p_minutes % 30 <> 0 then
    raise exception '휴게시간은 0.5시간 단위로 입력하세요';
  end if;
  if exists (select 1 from public.attendance_breaks where attendance_id = p_attendance_id and status = 'valid') then
    raise exception '휴게시간은 이미 입력되어 수정할 수 없습니다. 변경이 필요하면 사장님이나 관리자에게 요청하세요';
  end if;
  if v_att.clock_out is not null and p_minutes * interval '1 minute' >= v_att.clock_out - v_att.clock_in then
    raise exception '휴게시간이 근무시간보다 깁니다';
  end if;

  insert into public.attendance_breaks (attendance_id, minutes, entered_by)
  values (p_attendance_id, p_minutes, auth.uid());
exception when unique_violation then
  raise exception '휴게시간은 이미 입력되어 수정할 수 없습니다';
end;
$$;

-- ---------- 휴게시간 변경 (사장/관리자, 이전 값은 무효로 남김) ----------
create function public.admin_set_break(p_attendance_id bigint, p_minutes int, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.attendance;
begin
  select * into v_att from public.attendance where id = p_attendance_id and status = 'valid';
  if not found then
    raise exception '유효한 출퇴근 기록이 아닙니다';
  end if;
  perform public.assert_can_manage(v_att.user_id);
  if coalesce(trim(p_reason), '') = '' then
    raise exception '변경 사유를 입력하세요';
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 480 or p_minutes % 30 <> 0 then
    raise exception '휴게시간은 0.5시간 단위로 입력하세요';
  end if;
  if v_att.clock_out is not null and p_minutes * interval '1 minute' >= v_att.clock_out - v_att.clock_in then
    raise exception '휴게시간이 근무시간보다 깁니다';
  end if;

  update public.attendance_breaks
  set status = 'void', voided_by = auth.uid(), void_reason = p_reason
  where attendance_id = p_attendance_id and status = 'valid';

  insert into public.attendance_breaks (attendance_id, minutes, entered_by, reason)
  values (p_attendance_id, p_minutes, auth.uid(), p_reason);
end;
$$;

-- ---------- 정정 요청 (직원 본인) ----------
create function public.request_correction(
  p_type          text,
  p_attendance_id bigint,
  p_clock_in      timestamptz,
  p_clock_out     timestamptz,
  p_break_minutes int,
  p_reason        text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.attendance;
  v_emp public.employment_type;
  v_id  bigint;
begin
  select employment_type into v_emp from public.profiles where id = auth.uid() and is_active;
  if not found then
    raise exception '로그인이 필요합니다';
  end if;
  if p_type not in ('modify', 'add', 'void') then
    raise exception '요청 종류가 잘못되었습니다';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception '정정 사유를 입력하세요';
  end if;
  if p_break_minutes is not null and v_emp <> 'part_time' then
    raise exception '휴게시간은 아르바이트 직원만 입력합니다';
  end if;

  if p_type in ('modify', 'void') then
    select * into v_att from public.attendance where id = p_attendance_id and status = 'valid';
    if not found or v_att.user_id <> auth.uid() then
      raise exception '본인의 유효한 기록만 정정 요청할 수 있습니다';
    end if;
  end if;

  if p_type = 'modify' then
    perform public.assert_valid_times(p_clock_in, p_clock_out, v_att.clock_out is not null);
  elsif p_type = 'add' then
    perform public.assert_valid_times(p_clock_in, p_clock_out, true);
    if exists (
      select 1 from public.attendance
      where user_id = auth.uid() and status = 'valid'
        and work_date = (p_clock_in at time zone 'Asia/Seoul')::date
    ) then
      raise exception '그 날짜에는 이미 기록이 있습니다. 기존 기록의 수정 요청을 해 주세요';
    end if;
  end if;

  insert into public.correction_requests
    (user_id, request_type, attendance_id, proposed_clock_in, proposed_clock_out, proposed_break_minutes, reason)
  values (
    auth.uid(), p_type, p_attendance_id,
    case when p_type = 'void' then null else p_clock_in end,
    case when p_type = 'void' then null else p_clock_out end,
    case when p_type = 'void' then null else p_break_minutes end,
    trim(p_reason)
  )
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception '이 기록에 대해 이미 처리 대기 중인 정정 요청이 있습니다';
end;
$$;

create function public.cancel_correction(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.correction_requests set status = 'cancelled'
  where id = p_request_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception '취소할 수 있는 요청이 아닙니다';
  end if;
end;
$$;

-- ---------- 정정 요청 승인/거절 (사장/관리자) ----------
create function public.review_correction(p_request_id bigint, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req    public.correction_requests;
  v_result bigint;
begin
  select * into v_req from public.correction_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then
    raise exception '이미 처리된 요청입니다';
  end if;
  perform public.assert_can_manage(v_req.user_id);

  if p_approve then
    if v_req.request_type <> 'void' then
      perform public.assert_valid_times(
        v_req.proposed_clock_in, v_req.proposed_clock_out,
        v_req.request_type = 'add'
          or exists (select 1 from public.attendance where id = v_req.attendance_id and clock_out is not null)
      );
    end if;
    v_result := public.apply_attendance_change(
      v_req.request_type, v_req.attendance_id, v_req.user_id,
      v_req.proposed_clock_in, v_req.proposed_clock_out, v_req.proposed_break_minutes,
      format('정정 요청 #%s 승인: %s', v_req.id, v_req.reason),
      'correction'
    );
  end if;

  update public.correction_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      result_attendance_id = v_result
  where id = v_req.id;
end;
$$;

-- ---------- 사장/관리자 직접 정정 (역시 무효 + 새 기록) ----------
create function public.admin_correct_attendance(
  p_attendance_id bigint, p_clock_in timestamptz, p_clock_out timestamptz, p_break_minutes int, p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.attendance;
begin
  select * into v_att from public.attendance where id = p_attendance_id and status = 'valid';
  if not found then
    raise exception '이미 무효 처리되었거나 없는 기록입니다';
  end if;
  perform public.assert_can_manage(v_att.user_id);
  if coalesce(trim(p_reason), '') = '' then
    raise exception '정정 사유를 입력하세요';
  end if;
  perform public.assert_valid_times(p_clock_in, p_clock_out, v_att.clock_out is not null);
  return public.apply_attendance_change(
    'modify', p_attendance_id, null, p_clock_in, p_clock_out, p_break_minutes, trim(p_reason), 'admin');
end;
$$;

create function public.admin_add_attendance(
  p_user_id uuid, p_clock_in timestamptz, p_clock_out timestamptz, p_break_minutes int, p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_can_manage(p_user_id);
  if not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception '사용 중인 직원이 아닙니다';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception '추가 사유를 입력하세요';
  end if;
  perform public.assert_valid_times(p_clock_in, p_clock_out, true);
  return public.apply_attendance_change(
    'add', null, p_user_id, p_clock_in, p_clock_out, p_break_minutes, trim(p_reason), 'admin');
end;
$$;

create function public.admin_void_attendance(p_attendance_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.attendance;
begin
  select * into v_att from public.attendance where id = p_attendance_id and status = 'valid';
  if not found then
    raise exception '이미 무효 처리되었거나 없는 기록입니다';
  end if;
  perform public.assert_can_manage(v_att.user_id);
  if coalesce(trim(p_reason), '') = '' then
    raise exception '무효 사유를 입력하세요';
  end if;
  perform public.apply_attendance_change('void', p_attendance_id, null, null, null, null, trim(p_reason), 'admin');
end;
$$;

-- ---------- 실행 권한 ----------
revoke execute on function public.attendance_guard() from public, anon, authenticated;
revoke execute on function public.append_only_guard() from public, anon, authenticated;
revoke execute on function public.assert_can_manage(uuid) from public, anon, authenticated;
revoke execute on function public.assert_valid_times(timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.apply_attendance_change(text, bigint, uuid, timestamptz, timestamptz, int, text, text) from public, anon, authenticated;
revoke execute on function public.run_auto_clock_out() from public, anon, authenticated;

-- NFC 확인을 거친 서버만 출퇴근 기록 가능
revoke execute on function public.clock_in_for(uuid) from public, anon, authenticated;
revoke execute on function public.clock_out_for(uuid) from public, anon, authenticated;
grant execute on function public.clock_in_for(uuid) to service_role;
grant execute on function public.clock_out_for(uuid) to service_role;

-- 로그인한 사용자가 호출 (함수 안에서 본인/권한 확인)
revoke execute on function public.submit_break(bigint, int) from public, anon;
revoke execute on function public.admin_set_break(bigint, int, text) from public, anon;
revoke execute on function public.request_correction(text, bigint, timestamptz, timestamptz, int, text) from public, anon;
revoke execute on function public.cancel_correction(bigint) from public, anon;
revoke execute on function public.review_correction(bigint, boolean, text) from public, anon;
revoke execute on function public.admin_correct_attendance(bigint, timestamptz, timestamptz, int, text) from public, anon;
revoke execute on function public.admin_add_attendance(uuid, timestamptz, timestamptz, int, text) from public, anon;
revoke execute on function public.admin_void_attendance(bigint, text) from public, anon;
grant execute on function public.submit_break(bigint, int) to authenticated;
grant execute on function public.admin_set_break(bigint, int, text) to authenticated;
grant execute on function public.request_correction(text, bigint, timestamptz, timestamptz, int, text) to authenticated;
grant execute on function public.cancel_correction(bigint) to authenticated;
grant execute on function public.review_correction(bigint, boolean, text) to authenticated;
grant execute on function public.admin_correct_attendance(bigint, timestamptz, timestamptz, int, text) to authenticated;
grant execute on function public.admin_add_attendance(uuid, timestamptz, timestamptz, int, text) to authenticated;
grant execute on function public.admin_void_attendance(bigint, text) to authenticated;
