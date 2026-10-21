-- =========================================================
-- 매장 운영 관리 - 초기 스키마
--   profiles   : 직원 1명 = auth.users 1명 = profiles 1행 (공용 계정 없음)
--   attendance : 출근/퇴근 기록 (1회 근무 = 1행)
-- =========================================================

-- ---------- 타입 ----------
create type public.user_role as enum ('owner', 'manager', 'staff');          -- 사장 / 관리자 / 직원
create type public.employment_type as enum ('full_time', 'part_time');       -- 정규직 / 아르바이트

-- ---------- 직원 프로필 ----------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null unique,
  full_name       text not null,
  role            public.user_role not null default 'staff',
  employment_type public.employment_type not null default 'full_time',
  is_active       boolean not null default true,   -- 퇴사자는 false (기록은 보존)
  created_at      timestamptz not null default now()
);

-- ---------- 출퇴근 기록 ----------
create table public.attendance (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  work_date  date not null default (now() at time zone 'Asia/Seoul')::date,  -- 한국 시간 기준 근무일
  clock_in   timestamptz not null default now(),
  clock_out  timestamptz,                                                   -- null = 근무 중
  created_at timestamptz not null default now(),
  constraint clock_out_after_in check (clock_out is null or clock_out >= clock_in)
);

-- 한 사람은 동시에 '근무 중' 기록을 하나만 가질 수 있음 (중복 출근 방지)
create unique index attendance_one_open_per_user on public.attendance (user_id) where clock_out is null;
create index attendance_work_date_idx on public.attendance (work_date);
create index attendance_user_clock_in_idx on public.attendance (user_id, clock_in desc);

-- ---------- 회원 생성 시 프로필 자동 생성 ----------
-- 권한(role)은 항상 기본값 staff 로 시작. 사장이 앱에서(서버 전용 키로) 변경.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 권한 헬퍼 (RLS 재귀 방지용 security definer) ----------
create function public.my_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() in ('owner', 'manager'), false)
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.attendance enable row level security;

-- profiles: 본인 것은 조회 가능, 사장/관리자는 전원 조회
create policy "profiles_select_self_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- profiles: 수정은 사장만 (직원이 스스로 권한을 올리는 것 차단)
create policy "profiles_update_owner" on public.profiles
  for update to authenticated
  using (public.my_role() = 'owner')
  with check (public.my_role() = 'owner');

-- attendance: 본인 기록 조회, 사장/관리자는 전원 조회
create policy "attendance_select_self_or_admin" on public.attendance
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- attendance: 기록 정정은 사장만
create policy "attendance_update_owner" on public.attendance
  for update to authenticated
  using (public.my_role() = 'owner')
  with check (public.my_role() = 'owner');

-- insert 정책은 없음: 직원은 아래 toggle_clock() 으로만 출퇴근 기록 가능
-- (시간은 항상 서버 시각 now() 사용 → 시간 조작 불가)

-- ---------- 출근/퇴근 토글 ----------
create function public.toggle_clock()
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.attendance;
  v_row  public.attendance;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception '비활성화된 계정입니다';
  end if;

  select * into v_open
  from public.attendance
  where user_id = auth.uid() and clock_out is null
  for update;

  if found then
    -- 버튼 연타로 출근 직후 바로 퇴근되는 것 방지
    if v_open.clock_in > now() - interval '1 minute' then
      raise exception '방금 출근 처리되었습니다. 1분 후에 퇴근할 수 있습니다';
    end if;

    update public.attendance set clock_out = now()
    where id = v_open.id
    returning * into v_row;
  else
    insert into public.attendance (user_id) values (auth.uid())
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.toggle_clock() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.toggle_clock() to authenticated;
