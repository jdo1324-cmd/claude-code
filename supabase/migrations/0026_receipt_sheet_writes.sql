-- 전표가 매출 매입 장부에 적은 칸 (월 탭: 더한 금액 / 평균단가 탭: 적은 단가).
-- 다시 보내거나 무효 처리할 때 이 기록대로 되돌림 (예전엔 장부에 "앱 전표 기록"·"단가 기록" 탭을 만들어 보관했음).
set local lock_timeout = '10s';
create table public.receipt_sheet_writes (
  id          bigint generated always as identity primary key,
  receipt_id  bigint not null references public.receipts (id),
  kind        text not null check (kind in ('ledger', 'price')),
  tab         text not null,
  cell        text not null,
  amount      numeric not null,
  created_at  timestamptz not null default now()
);
create index receipt_sheet_writes_receipt_idx on public.receipt_sheet_writes (receipt_id);
alter table public.receipt_sheet_writes enable row level security;
create policy "receipt_sheet_writes_select_admin" on public.receipt_sheet_writes
  for select to authenticated using (public.is_admin());
