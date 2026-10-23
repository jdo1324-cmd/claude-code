-- 전표: AI가 읽은 값과 확정한 값이 다른 곳 (다음 AI 읽기 때 참고 + 자주 틀리는 품목 보기)
set local lock_timeout = '10s';
create table public.receipt_corrections (
  id               bigint generated always as identity primary key,
  receipt_id       bigint not null references public.receipts (id),
  vendor           text,
  field            text not null check (field in ('name', 'unit', 'quantity', 'unit_price', 'line_total', 'added', 'removed')),
  ai_value         text,
  confirmed_value  text,
  item_name        text,
  created_at       timestamptz not null default now()
);
create index receipt_corrections_created_idx on public.receipt_corrections (created_at);
alter table public.receipt_corrections enable row level security;
create policy "receipt_corrections_select_admin" on public.receipt_corrections
  for select to authenticated using (public.is_admin());
