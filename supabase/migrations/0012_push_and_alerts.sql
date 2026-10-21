-- =========================================================
-- 0012: 사장님 홈 · 푸시 알림 · 매일 밤 점검
--   - 웹 푸시 키(VAPID)와 점검용 비밀값은 서버 전용 store_settings 에 보관 (앱이 처음 쓸 때 VAPID 생성)
--   - 매일 22:00(한국) Supabase pg_cron → pg_net 으로 앱의 점검 주소 호출
-- =========================================================

alter table public.store_settings
  add column vapid_public  text,
  add column vapid_private text,
  add column cron_secret   text not null default encode(extensions.gen_random_bytes(24), 'hex');

-- ---------- 푸시 구독 (휴대폰/브라우저별) ----------
create table public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
-- 쓰기는 서버(비밀 키)에서만

-- ---------- 사진 항목인데 사진이 없거나 파일이 사라진 완료 기록 ----------
create function public.checklist_photo_issues(p_from date)
returns table (entry_id bigint, work_date date, item_title text, done_by uuid, done_at timestamptz, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.work_date, i.title, e.done_by, e.done_at,
         case when e.photo_path is null then '사진 없이 완료' else '사진 파일 없음' end
  from public.checklist_entries e
  join public.checklist_items i on i.id = e.item_id
  where e.status = 'valid' and i.item_type = 'photo' and e.work_date >= p_from
    and (e.photo_path is null or not exists (
      select 1 from storage.objects o where o.bucket_id = 'checklist-photos' and o.name = e.photo_path))
    and (public.is_admin() or auth.role() = 'service_role')
  order by e.work_date desc, e.done_at
$$;
revoke execute on function public.checklist_photo_issues(date) from public, anon;
grant execute on function public.checklist_photo_issues(date) to authenticated, service_role;

-- ---------- 매일 밤 22:00(한국) 점검 호출 ----------
create extension if not exists pg_net;
select cron.schedule(
  'daily-alerts',
  '0 13 * * *',  -- UTC 13:00 = 한국 22:00
  $$
  select net.http_post(
    url := 'https://store-ops-tau.vercel.app/api/cron/daily-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select cron_secret from public.store_settings where id = 1)
    ),
    body := '{}'::jsonb
  )
  $$
);
