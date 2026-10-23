-- 0018: 체크리스트 주간·월간 주기, 비포·애프터 사진 + 알림 시각/켜기 설정
-- (DB에는 여러 번에 나눠 적용: checklist_frequency_and_before_after, checklist_complete_period_and_before_after,
--  checklist_before_photo_fn, checklist_upsert_item_fn, alert_settings_and_tick)

-- ---------- 주기 / 사진 방식 ----------
alter table public.checklist_items
  add column frequency text not null default 'daily' check (frequency in ('daily', 'weekly', 'monthly')),
  add column photo_mode text not null default 'single' check (photo_mode in ('single', 'before_after'));
alter table public.checklist_entries add column photo_before_path text;

create table public.checklist_before_photos (
  item_id      bigint not null references public.checklist_items (id),
  period_start date not null,
  photo_path   text not null,
  uploaded_by  uuid not null references public.profiles (id),
  uploaded_at  timestamptz not null default now(),
  primary key (item_id, period_start)
);
alter table public.checklist_before_photos enable row level security;
create policy "checklist_before_photos_select_members" on public.checklist_before_photos
  for select to authenticated using (public.is_active_member());

-- 주기의 첫날: 매일=그날, 주간=그 주 월요일, 월간=그 달 1일
create function public.checklist_period_start(p_frequency text, p_date date)
returns date language sql immutable set search_path = '' as $$
  select case p_frequency
    when 'weekly' then p_date - (extract(isodow from p_date)::int - 1)
    when 'monthly' then date_trunc('month', p_date)::date
    else p_date
  end
$$;

-- 매출 정산 저장 조건은 "매일" 마감 필수 항목만
create or replace function public.missing_required_close_items(p_date date)
returns table (id bigint, category text, title text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.category, i.title
  from public.checklist_items i
  where i.phase = 'close' and i.is_required and i.is_active and i.frequency = 'daily'
    and public.checklist_item_applies(i.weekdays, p_date)
    and not exists (
      select 1 from public.checklist_entries e
      where e.item_id = i.id and e.work_date = p_date and e.status = 'valid'
    )
  order by i.sort_order
$$;

-- complete_checklist_item: 매일 항목만 요일 확인, 주간·월간은 그 기간에 한 번만,
-- 비포·애프터 항목은 비포 사진이 있어야 애프터 사진으로 완료 (photo_before_path 에 함께 기록)
--   → 본문은 DB 적용본과 같음 (checklist_complete_period_and_before_after)

-- set_checklist_before_photo(p_item_id, p_photo_path): 비포 사진 저장 (완료 전까지 다시 찍기 가능)
-- upsert_checklist_item(..., p_weekdays, p_frequency, p_photo_mode): 항목 추가/수정.
--   종류·주기·사진 방식이 바뀌고 기록이 있으면 새 항목으로 만들고 기존 항목은 사용 중지

-- ---------- 알림 설정 ----------
create table public.alert_settings (
  kind       text primary key,
  enabled    boolean not null default true,
  send_time  time,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.alert_settings enable row level security;
insert into public.alert_settings (kind, send_time) values
  ('checklist_reminder', '20:00'), ('daily_summary', '20:00'),
  ('correction', null), ('receipt', null), ('sales_report', null);

create table public.alert_runs (
  kind text not null, run_date date not null, ran_at timestamptz not null default now(),
  primary key (kind, run_date)
);
alter table public.alert_runs enable row level security;

create table public.alert_sent_keys (key text primary key, sent_at timestamptz not null default now());
alter table public.alert_sent_keys enable row level security;

-- 고정 시각 작업 두 개 → 5분마다 /api/cron/tick 이 설정 시각을 확인
select cron.unschedule('daily-alerts');
select cron.unschedule('checklist-reminder');
select cron.schedule('alert-tick', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://store-ops-tau.vercel.app/api/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select cron_secret from public.store_settings where id = 1)
    ),
    body := '{}'::jsonb
  )
$$);
