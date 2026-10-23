-- 0017: 잔디(팀 웹훅)로 사장/관리자에게 1:1 알림 + 밤 8시 30분 체크리스트 미완료 알림

-- 잔디 팀 웹훅 주소 (서버 전용)
create table public.jandi_settings (
  id          int primary key default 1 check (id = 1),
  webhook_url text,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);
alter table public.jandi_settings enable row level security;
insert into public.jandi_settings (id) values (1);

-- 잔디로 받을 사람과 그 사람의 잔디 로그인 이메일
create table public.jandi_recipients (
  user_id    uuid primary key references public.profiles (id),
  email      text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.jandi_recipients enable row level security;

-- 매일 20:30(한국) 체크리스트 미완료 알림 호출 (UTC 11:30)
select cron.schedule(
  'checklist-reminder',
  '30 11 * * *',
  $$
  select net.http_post(
    url := 'https://store-ops-tau.vercel.app/api/cron/checklist-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select cron_secret from public.store_settings where id = 1)
    ),
    body := '{}'::jsonb
  )
  $$
);
