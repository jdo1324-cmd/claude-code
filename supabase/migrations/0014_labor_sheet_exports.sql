-- 0014: 월별 출퇴근 기록을 손익계산서 "N월 인건비" 탭으로 보낸 기록
create table public.labor_sheet_exports (
  id       bigint generated always as identity primary key,
  month    text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  from_day int not null,
  to_day   int not null,
  sent_by  uuid not null references public.profiles (id),
  sent_at  timestamptz not null default now()
);
create index labor_sheet_exports_month_idx on public.labor_sheet_exports (month, sent_at desc);
alter table public.labor_sheet_exports enable row level security;
create policy "labor_sheet_exports_select_owner" on public.labor_sheet_exports
  for select to authenticated using (public.my_role() = 'owner');
