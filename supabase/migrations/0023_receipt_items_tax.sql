-- 전표 품목: 공급가(line_total) + 세액(tax). 단가(unit_price)는 (공급가 + 세액) ÷ 수량으로 계산해 기록.
-- 전표에 적힌 단가는 listed_unit_price (선택).
set local lock_timeout = '10s';
alter table public.receipt_items add column tax numeric;
alter table public.receipt_items add column listed_unit_price numeric;
alter table public.receipt_corrections drop constraint receipt_corrections_field_check;
alter table public.receipt_corrections add constraint receipt_corrections_field_check
  check (field in ('name', 'unit', 'quantity', 'unit_price', 'line_total', 'tax', 'added', 'removed'));

create or replace function public.confirm_receipt(p_id bigint, p_vendor text, p_receipt_date date, p_total numeric, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  jsonb;
  v_no    int := 0;
  v_name  text;
  v_qty   numeric;
  v_sup   numeric;
  v_tax   numeric;
begin
  perform 1 from public.receipts
  where id = p_id and status in ('proposed', 'failed') and (public.is_admin() or created_by = auth.uid())
  for update;
  if not found then
    raise exception '확정할 수 있는 전표가 아닙니다 (이미 확정·반려되었거나, 아직 읽는 중이거나, 내가 올린 전표가 아님)';
  end if;
  if coalesce(trim(p_vendor), '') = '' then
    raise exception '거래처를 입력하세요';
  end if;
  if p_receipt_date is null then
    raise exception '전표 날짜를 입력하세요';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '품목을 한 개 이상 입력하세요';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_no := v_no + 1;
    v_name := trim(coalesce(v_item ->> 'name', ''));
    if v_name = '' then
      raise exception '%번째 품목 이름이 비어 있습니다', v_no;
    end if;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_sup := (v_item ->> 'line_total')::numeric;
    v_tax := (v_item ->> 'tax')::numeric;
    if coalesce(v_qty, 0) <= 0 or v_sup is null then
      raise exception '%번째 품목(%)의 수량·공급가를 확인하세요', v_no, v_name;
    end if;
    insert into public.receipt_items
      (receipt_id, line_no, item_name, normalized_name, quantity, unit, unit_price, listed_unit_price, line_total, tax, ledger_item)
    values (
      p_id, v_no, v_name, lower(regexp_replace(v_name, '\s+', '', 'g')),
      v_qty,
      nullif(trim(coalesce(v_item ->> 'unit', '')), ''),
      round((v_sup + coalesce(v_tax, 0)) / v_qty, 2),
      (v_item ->> 'unit_price')::numeric,
      v_sup,
      v_tax,
      nullif(trim(coalesce(v_item ->> 'ledger_item', '')), '')
    );
  end loop;

  update public.receipts
  set status = 'confirmed', vendor = trim(p_vendor), receipt_date = p_receipt_date,
      total_amount = p_total, confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_id;
end;
$$;
