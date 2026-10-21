-- =========================================================
-- 0004: 자동 퇴근 처리
--   21:30(한국 시간)까지 퇴근을 안 찍으면 21:00 퇴근으로 기록하고 "자동 퇴근 처리" 표시.
-- =========================================================

alter table public.attendance
  add column auto_clock_out boolean not null default false;

-- 자동 퇴근 대상 처리. 10분마다 실행 + 출퇴근 태그를 찍을 때마다 먼저 실행.
create function public.run_auto_clock_out()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.attendance
  set clock_out = greatest(((work_date + time '21:00') at time zone 'Asia/Seoul'), clock_in),
      auto_clock_out = true
  where clock_out is null
    and now() >= ((work_date + time '21:30') at time zone 'Asia/Seoul');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.run_auto_clock_out() from public, anon, authenticated;

-- 사장/관리자가 퇴근 시간을 직접 고치면 "자동 퇴근 처리" 표시는 지움 (대신 "수정됨" 표시)
create or replace function public.attendance_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.work_date := (new.clock_in at time zone 'Asia/Seoul')::date;
  if auth.uid() is not null then
    new.edited_by := auth.uid();
    new.edited_at := now();
    if tg_op = 'UPDATE' and new.clock_out is distinct from old.clock_out then
      new.auto_clock_out := false;
    end if;
  end if;
  return new;
end;
$$;

-- 출퇴근 태그: 자동 퇴근 먼저 처리하고, 오늘 자동 퇴근된 사람은 다시 출근되지 않게 막음
create or replace function public.clock_toggle_for(p_user_id uuid)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open  public.attendance;
  v_row   public.attendance;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception '비활성화된 계정입니다';
  end if;

  perform public.run_auto_clock_out();

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
    if exists (
      select 1 from public.attendance
      where user_id = p_user_id and work_date = v_today and auto_clock_out
    ) then
      raise exception '오늘은 21:00로 자동 퇴근 처리되었습니다. 실제 퇴근 시간은 사장님이나 관리자에게 수정을 요청하세요';
    end if;

    insert into public.attendance (user_id) values (p_user_id)
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- 10분마다 자동 퇴근 처리 (Supabase pg_cron)
create extension if not exists pg_cron;
select cron.schedule('auto-clock-out', '*/10 * * * *', 'select public.run_auto_clock_out()');
