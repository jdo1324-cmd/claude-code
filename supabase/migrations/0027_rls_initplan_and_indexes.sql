-- 가볍게: RLS 정책의 auth.uid()·is_admin()을 (select …)로 감싸 한 번만 계산, 같은 표의 겹치는 정책은 하나로 합침,
-- 자주 찾는 외래키에 인덱스.
set local lock_timeout = '10s';

alter policy "attendance_select_self_or_admin" on public.attendance
  using (user_id = (select auth.uid()) or (select public.is_admin()));
alter policy "breaks_select_own_or_admin" on public.attendance_breaks
  using ((select public.is_admin()) or exists (
    select 1 from public.attendance a where a.id = attendance_breaks.attendance_id and a.user_id = (select auth.uid())));
alter policy "corrections_select_own_or_admin" on public.correction_requests
  using (user_id = (select auth.uid()) or (select public.is_admin()));
alter policy "pay_rates_select_owner_or_self" on public.pay_rates
  using ((select public.my_role()) = 'owner'::public.user_role or user_id = (select auth.uid()));
alter policy "profiles_select_self_or_admin" on public.profiles
  using (id = (select auth.uid()) or (select public.is_admin()));
alter policy "push_subscriptions_select_own" on public.push_subscriptions
  using (user_id = (select auth.uid()));
alter policy "sales_reports_select" on public.sales_reports
  using ((select public.is_admin()) or submitted_by = (select auth.uid()));

-- 전표: 관리자용 + 올린 사람용 두 정책 → 하나로
drop policy "receipts_select_admin" on public.receipts;
alter policy "receipts_select_own" on public.receipts
  using ((select public.is_admin()) or created_by = (select auth.uid()));
drop policy "receipt_items_select_admin" on public.receipt_items;
alter policy "receipt_items_select_own" on public.receipt_items
  using ((select public.is_admin()) or exists (
    select 1 from public.receipts r where r.id = receipt_items.receipt_id and r.created_by = (select auth.uid())));
drop policy "receipt_sheet_exports_select_admin" on public.receipt_sheet_exports;
alter policy "receipt_sheet_exports_select_own" on public.receipt_sheet_exports
  using ((select public.is_admin()) or exists (
    select 1 from public.receipts r where r.id = receipt_sheet_exports.receipt_id and r.created_by = (select auth.uid())));

create index if not exists receipt_items_receipt_idx on public.receipt_items (receipt_id);
create index if not exists receipts_created_by_idx on public.receipts (created_by, created_at desc);
create index if not exists receipt_corrections_receipt_idx on public.receipt_corrections (receipt_id);
create index if not exists correction_requests_user_idx on public.correction_requests (user_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index if not exists checklist_entries_item_idx on public.checklist_entries (item_id);
