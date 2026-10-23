-- 0016: 시험 알림이 휴대폰에 도착했는지 / 화면에 떴는지 기록 (원인 찾기용)
create table public.push_tests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id),
  sent_at      timestamptz not null default now(),
  push_status  int,             -- 푸시 서버 응답 코드
  received_at  timestamptz,     -- 휴대폰(서비스 워커)이 받은 시각
  shown_at     timestamptz,     -- 알림을 화면에 띄운 시각
  show_error   text             -- 띄우지 못했을 때 이유
);
alter table public.push_tests enable row level security;
-- 정책 없음: 서버(비밀 키)에서만 읽고 씀
