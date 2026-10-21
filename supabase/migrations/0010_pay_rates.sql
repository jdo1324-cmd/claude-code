-- =========================================================
-- 0010: 시급 / 월급 이력
--   - "몇 월 며칠부터 얼마" 이력. 지난 근무 금액이 바뀌지 않도록:
--       * 직원의 첫 등록이 아니면 적용일은 오늘(한국 시간) 이후만
--       * 무효 처리는 아직 적용 전(적용일이 오늘 이후)이거나 오늘 등록한 것만
--   - 관리·조회: 사장. 직원은 본인 것만 조회.
-- =========================================================

create table public.pay_rates (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles (id),
  pay_type       text not null check (pay_type in ('hourly', 'monthly')),  -- 시급 / 월급
  amount         bigint not null check (amount > 0),                       -- 원
  effective_from date not null,
  note           text,
  created_by     uuid not null references public.profiles (id),
  created_at     timestamptz not null default now(),
  status         text not null default 'valid' check (status in ('valid', 'void')),
  voided_by      uuid references public.profiles (id),
  voided_at      timestamptz,
  void_reason    text
);
create unique index pay_rates_one_per_day on public.pay_rates (user_id, effective_from) where status = 'valid';
alter table public.pay_rates enable row level security;

create policy "pay_rates_select_owner_or_self" on public.pay_rates
  for select to authenticated
  using (public.my_role() = 'owner' or user_id = auth.uid());

create function public.pay_rate_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '급여 이력은 삭제할 수 없습니다';
  end if;
  if old.status = 'valid' and new.status = 'void'
     and new.user_id = old.user_id and new.pay_type = old.pay_type and new.amount = old.amount
     and new.effective_from = old.effective_from and new.note is not distinct from old.note
     and new.created_by = old.created_by and new.created_at = old.created_at then
    new.voided_at := coalesce(new.voided_at, now());
    return new;
  end if;
  raise exception '급여 이력은 수정할 수 없습니다. 새 적용일로 추가하세요';
end;
$$;
create trigger pay_rates_guard
  before update or delete on public.pay_rates
  for each row execute function public.pay_rate_guard();
revoke execute on function public.pay_rate_guard() from public, anon, authenticated;

create function public.add_pay_rate(
  p_user_id uuid, p_pay_type text, p_amount bigint, p_effective_from date, p_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_id    bigint;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception '급여 정보는 사장만 등록할 수 있습니다';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception '없는 직원입니다';
  end if;
  if p_pay_type not in ('hourly', 'monthly') then
    raise exception '시급 또는 월급을 고르세요';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception '금액을 입력하세요';
  end if;
  if p_effective_from is null then
    raise exception '적용 시작일을 입력하세요';
  end if;
  -- 이미 이력이 있으면 지난 날짜로 넣을 수 없음 (예전 근무 금액이 바뀌므로)
  if exists (select 1 from public.pay_rates where user_id = p_user_id and status = 'valid')
     and p_effective_from < v_today then
    raise exception '지난 날짜부터 적용할 수 없습니다. 예전 근무 금액이 바뀌기 때문입니다 (오늘 이후 날짜로 등록하세요)';
  end if;

  insert into public.pay_rates (user_id, pay_type, amount, effective_from, note, created_by)
  values (p_user_id, p_pay_type, p_amount, p_effective_from, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception '같은 날짜에 이미 등록된 금액이 있습니다. 잘못된 것이면 먼저 무효 처리하세요';
end;
$$;

create function public.void_pay_rate(p_rate_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate  public.pay_rates;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception '급여 정보는 사장만 관리할 수 있습니다';
  end if;
  select * into v_rate from public.pay_rates where id = p_rate_id and status = 'valid' for update;
  if not found then
    raise exception '이미 무효 처리되었거나 없는 이력입니다';
  end if;
  if v_rate.effective_from < v_today and (v_rate.created_at at time zone 'Asia/Seoul')::date <> v_today then
    raise exception '이미 적용된 급여 이력은 무효 처리할 수 없습니다 (예전 근무 금액이 바뀌기 때문입니다)';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception '무효 사유를 입력하세요';
  end if;
  update public.pay_rates set status = 'void', voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = p_rate_id;
end;
$$;

revoke execute on function public.add_pay_rate(uuid, text, bigint, date, text) from public, anon;
revoke execute on function public.void_pay_rate(bigint, text) from public, anon;
grant execute on function public.add_pay_rate(uuid, text, bigint, date, text) to authenticated;
grant execute on function public.void_pay_rate(bigint, text) to authenticated;
