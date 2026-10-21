-- =========================================================
-- 0002: 매장 와이파이/NFC 제한 + 관리자 출퇴근 기록 수정
-- =========================================================

-- ---------- 매장 설정 (1행만 존재) ----------
-- 서버(비밀 키)에서만 읽고 씀. RLS 켜고 정책 없음 = 브라우저에서 직접 접근 불가.
create table public.store_settings (
  id                     int primary key default 1 check (id = 1),
  require_store_network  boolean not null default false,  -- true면 매장 와이파이(IP) 또는 NFC로만 출퇴근
  allowed_ips            text[] not null default '{}',    -- 매장 와이파이의 공인 IP
  nfc_token              text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  updated_at             timestamptz not null default now()
);
insert into public.store_settings (id) values (1);
alter table public.store_settings enable row level security;

-- ---------- 출퇴근은 서버를 통해서만 ----------
-- 직원이 Supabase API를 직접 호출해서 와이파이/NFC 검사를 건너뛰지 못하게,
-- 기존 toggle_clock() 을 없애고 서버 전용(service_role) 함수로 교체.
drop function public.toggle_clock();

create function public.clock_toggle_for(p_user_id uuid)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.attendance;
  v_row  public.attendance;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception '비활성화된 계정입니다';
  end if;

  select * into v_open
  from public.attendance
  where user_id = p_user_id and clock_out is null
  for update;

  if found then
    if v_open.clock_in > now() - interval '1 minute' then
      raise exception '방금 출근 처리되었습니다. 1분 후에 퇴근할 수 있습니다';
    end if;

    update public.attendance set clock_out = now()
    where id = v_open.id
    returning * into v_row;
  else
    insert into public.attendance (user_id) values (p_user_id)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.clock_toggle_for(uuid) from public, anon, authenticated;
grant execute on function public.clock_toggle_for(uuid) to service_role;

-- ---------- 기록 수정 이력 ----------
alter table public.attendance
  add column edited_by uuid references public.profiles (id),
  add column edited_at timestamptz;

create table public.attendance_logs (
  id            bigint generated always as identity primary key,
  attendance_id bigint not null,
  action        text not null,            -- insert / update
  changed_by    uuid references public.profiles (id),
  changed_at    timestamptz not null default now(),
  old_clock_in  timestamptz,
  old_clock_out timestamptz,
  new_clock_in  timestamptz,
  new_clock_out timestamptz
);
create index attendance_logs_attendance_idx on public.attendance_logs (attendance_id);
alter table public.attendance_logs enable row level security;

create policy "attendance_logs_select_admin" on public.attendance_logs
  for select to authenticated
  using (public.is_admin());

-- 사람이 직접 수정/추가한 경우(auth.uid() 있음)만 기록. 출퇴근 버튼(서버)은 기록하지 않음.
create function public.attendance_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.work_date := (new.clock_in at time zone 'Asia/Seoul')::date;
  if auth.uid() is not null then
    new.edited_by := auth.uid();
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger attendance_before_write
  before insert or update on public.attendance
  for each row execute function public.attendance_before_write();

create function public.attendance_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    insert into public.attendance_logs
      (attendance_id, action, changed_by, old_clock_in, old_clock_out, new_clock_in, new_clock_out)
    values (
      new.id,
      lower(tg_op),
      auth.uid(),
      case when tg_op = 'UPDATE' then old.clock_in end,
      case when tg_op = 'UPDATE' then old.clock_out end,
      new.clock_in,
      new.clock_out
    );
  end if;
  return new;
end;
$$;

create trigger attendance_after_write
  after insert or update on public.attendance
  for each row execute function public.attendance_after_write();

revoke execute on function public.attendance_before_write() from public, anon, authenticated;
revoke execute on function public.attendance_after_write() from public, anon, authenticated;

-- ---------- 기록 수정 권한: 사장 = 전원, 관리자 = 본인 제외 전원 ----------
drop policy "attendance_update_owner" on public.attendance;

create policy "attendance_update_admin" on public.attendance
  for update to authenticated
  using (public.my_role() = 'owner' or (public.my_role() = 'manager' and user_id <> auth.uid()))
  with check (public.my_role() = 'owner' or (public.my_role() = 'manager' and user_id <> auth.uid()));

-- 출근을 깜빡한 날의 기록 추가
create policy "attendance_insert_admin" on public.attendance
  for insert to authenticated
  with check (public.my_role() = 'owner' or (public.my_role() = 'manager' and user_id <> auth.uid()));
