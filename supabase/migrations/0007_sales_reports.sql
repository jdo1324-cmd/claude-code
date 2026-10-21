-- =========================================================
-- 0007: 매출 정산 보고서 + 체크리스트 보조
-- =========================================================

-- 체크리스트 화면에서 "누가 했는지" 이름을 보여주기 위한 함수
-- (직원은 profiles 에서 본인만 볼 수 있으므로, 사용 중인 직원에게 이름만 공개)
create function public.member_names()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name from public.profiles p where public.is_active_member()
$$;
revoke execute on function public.member_names() from public, anon;
grant execute on function public.member_names() to authenticated;

-- 매출 금액은 정산 보고서에서 입력하므로 체크리스트의 같은 숫자 항목은 사용 중지 (기록 없음)
update public.checklist_items set is_active = false
where phase = 'close' and title in ('포스 매출 마감 금액', '현금 시재 금액');

-- 오늘 마감 필수 항목 중 아직 안 된 항목
create function public.missing_required_close_items(p_date date)
returns table (id bigint, category text, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.category, i.title
  from public.checklist_items i
  where i.phase = 'close' and i.is_required and i.is_active
    and not exists (
      select 1 from public.checklist_entries e
      where e.item_id = i.id and e.work_date = p_date and e.status = 'valid'
    )
  order by i.sort_order
$$;
revoke execute on function public.missing_required_close_items(date) from public, anon;
grant execute on function public.missing_required_close_items(date) to authenticated;

-- ---------- 매출 정산 보고서 ----------
create table public.sales_reports (
  id                 bigint generated always as identity primary key,
  work_date          date not null default (now() at time zone 'Asia/Seoul')::date,
  total_sales        bigint not null check (total_sales >= 0),
  card_amount        bigint not null check (card_amount >= 0),
  cash_amount        bigint not null check (cash_amount >= 0),
  other_amount       bigint not null check (other_amount >= 0),
  cash_expense       bigint not null default 0 check (cash_expense >= 0),        -- 오늘 현금 지출
  check_card_expense bigint not null default 0 check (check_card_expense >= 0),  -- 오늘 체크카드 지출
  note               text,
  submitted_by       uuid not null references public.profiles (id),
  submitted_at       timestamptz not null default now(),
  replaces_id        bigint references public.sales_reports (id),
  status             text not null default 'valid' check (status in ('valid', 'void')),
  voided_by          uuid references public.profiles (id),
  voided_at          timestamptz,
  void_reason        text
);
create unique index sales_reports_one_valid on public.sales_reports (work_date) where status = 'valid';
alter table public.sales_reports enable row level security;

-- 사장/관리자: 전체. 직원: 오늘 보고서만 (제출 여부 확인용)
create policy "sales_reports_select" on public.sales_reports
  for select to authenticated
  using (
    public.is_admin()
    or (public.is_active_member() and work_date = (now() at time zone 'Asia/Seoul')::date)
  );

create function public.sales_report_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '매출 보고서는 삭제할 수 없습니다';
  end if;
  if old.status = 'valid' and new.status = 'void'
     and new.work_date = old.work_date and new.total_sales = old.total_sales
     and new.card_amount = old.card_amount and new.cash_amount = old.cash_amount
     and new.other_amount = old.other_amount and new.cash_expense = old.cash_expense
     and new.check_card_expense = old.check_card_expense
     and new.note is not distinct from old.note
     and new.submitted_by = old.submitted_by and new.submitted_at = old.submitted_at
     and new.replaces_id is not distinct from old.replaces_id then
    new.voided_at := coalesce(new.voided_at, now());
    return new;
  end if;
  raise exception '매출 보고서는 수정할 수 없습니다. 다시 작성하세요 (이전 보고서는 무효로 남습니다)';
end;
$$;
create trigger sales_reports_guard
  before update or delete on public.sales_reports
  for each row execute function public.sales_report_guard();
revoke execute on function public.sales_report_guard() from public, anon, authenticated;

-- 저장: 마감 필수 체크리스트가 모두 끝나야 함. 오늘 것이 이미 있으면 "다시 작성"(이전 것 무효 + 사유)
create function public.submit_sales_report(
  p_total bigint, p_card bigint, p_cash bigint, p_other bigint,
  p_cash_expense bigint, p_check_card_expense bigint, p_note text, p_replace_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date := (now() at time zone 'Asia/Seoul')::date;
  v_missing text;
  v_old     public.sales_reports;
  v_id      bigint;
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요합니다';
  end if;
  if p_total is null or p_card is null or p_cash is null or p_other is null then
    raise exception '매출과 결제수단별 금액을 모두 입력하세요 (없으면 0)';
  end if;
  if least(p_total, p_card, p_cash, p_other, coalesce(p_cash_expense, 0), coalesce(p_check_card_expense, 0)) < 0 then
    raise exception '금액은 0 이상이어야 합니다';
  end if;

  select string_agg(m.title, ', ') into v_missing from public.missing_required_close_items(v_today) m;
  if v_missing is not null then
    raise exception '마감 필수 체크리스트를 먼저 모두 완료하세요. 남은 항목: %', v_missing;
  end if;

  select * into v_old from public.sales_reports where work_date = v_today and status = 'valid' for update;
  if found then
    if not (public.is_admin() or v_old.submitted_by = auth.uid()) then
      raise exception '오늘 보고서는 이미 제출되었습니다. 다시 작성은 제출한 사람이나 사장/관리자만 할 수 있습니다';
    end if;
    if coalesce(trim(p_replace_reason), '') = '' then
      raise exception '다시 작성하는 사유를 입력하세요';
    end if;
    update public.sales_reports
    set status = 'void', voided_by = auth.uid(), void_reason = trim(p_replace_reason)
    where id = v_old.id;
  end if;

  insert into public.sales_reports
    (total_sales, card_amount, cash_amount, other_amount, cash_expense, check_card_expense, note, submitted_by, replaces_id)
  values (
    p_total, p_card, p_cash, p_other, coalesce(p_cash_expense, 0), coalesce(p_check_card_expense, 0),
    nullif(trim(coalesce(p_note, '')), ''), auth.uid(), v_old.id
  )
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception '방금 다른 직원이 보고서를 제출했습니다. 화면을 새로고침하세요';
end;
$$;
revoke execute on function public.submit_sales_report(bigint, bigint, bigint, bigint, bigint, bigint, text, text) from public, anon;
grant execute on function public.submit_sales_report(bigint, bigint, bigint, bigint, bigint, bigint, text, text) to authenticated;
