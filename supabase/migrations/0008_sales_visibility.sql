-- 0008: 매출 금액은 사장/관리자와 제출한 본인만 조회. 다른 직원은 "오늘 제출 여부"만 확인.
drop policy "sales_reports_select" on public.sales_reports;

create policy "sales_reports_select" on public.sales_reports
  for select to authenticated
  using (public.is_admin() or submitted_by = auth.uid());

create function public.sales_report_status(p_date date)
returns table (submitted_by uuid, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.submitted_by, s.submitted_at
  from public.sales_reports s
  where s.work_date = p_date and s.status = 'valid' and public.is_active_member()
$$;
revoke execute on function public.sales_report_status(date) from public, anon;
grant execute on function public.sales_report_status(date) to authenticated;
