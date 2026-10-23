-- 일용직 기록, 놓친 일 점검 알림 세분화, 사진 항목 저장 가드
set local lock_timeout = '10s';

-- ---------- 일용직 근무 기록 ----------
create table public.day_labor_entries (
  id           bigint generated always as identity primary key,
  work_date    date not null,
  worker_name  text not null check (length(trim(worker_name)) > 0),
  hours        numeric(4, 1) not null check (hours > 0 and hours <= 24),
  daily_wage   integer not null check (daily_wage >= 0),
  extra_pay    integer not null default 0 check (extra_pay >= 0),
  note         text,
  status       text not null default 'valid' check (status in ('valid', 'void')),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  voided_by    uuid references public.profiles (id),
  voided_at    timestamptz
);
create index day_labor_entries_date_idx on public.day_labor_entries (work_date);
alter table public.day_labor_entries enable row level security;
create policy "day_labor_entries_select_admin" on public.day_labor_entries
  for select to authenticated using (public.is_admin());

create table public.day_labor_sheet_exports (
  id       bigint generated always as identity primary key,
  month    text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  sent_by  uuid not null references public.profiles (id),
  sent_at  timestamptz not null default now()
);
alter table public.day_labor_sheet_exports enable row level security;

-- ---------- 사진 항목은 사진 없이 저장될 수 없게 (완료 함수 말고 저장 단계에서도 한 번 더) ----------
create function public.checklist_entry_photo_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
  v_mode text;
begin
  select item_type, photo_mode into v_type, v_mode from public.checklist_items where id = new.item_id;
  if v_type = 'photo' and new.photo_path is null then
    raise exception '사진 항목은 사진을 찍어야 완료됩니다';
  end if;
  if v_type = 'photo' and v_mode = 'before_after' and new.photo_before_path is null then
    raise exception '비포 사진과 애프터 사진이 모두 있어야 완료됩니다';
  end if;
  return new;
end;
$$;
create trigger checklist_entry_photo_guard
  before insert on public.checklist_entries
  for each row execute function public.checklist_entry_photo_guard();

-- ---------- 알림: 놓친 일 점검을 종류별로 + 휴대폰 웹 알림 켜기/끄기 ----------
insert into public.alert_settings (kind, enabled, send_time) values
  ('missed_clock_out', true, '20:00'),
  ('missing_break', true, '20:00'),
  ('missing_sales_report', false, '20:00'),
  ('photo_issue', true, '20:00'),
  ('channel_web_push', false, null)
on conflict (kind) do nothing;
update public.alert_settings set enabled = false where kind in ('daily_summary', 'sales_report');
