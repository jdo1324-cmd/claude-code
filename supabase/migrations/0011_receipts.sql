-- =========================================================
-- 0011: 거래처 전표(영수증) AI 읽기
--   - 직원: 사진 1~3장 올리기만 (올린 뒤에는 볼 수 없음)
--   - AI(Claude)가 읽은 값은 "제안"(proposal)으로만 저장
--   - 사장/관리자가 사진과 대조 후 "확정" → receipt_items 에 실제 기록
--   - 확정된 품목 기준으로 같은 품목 단가 변동 확인 (receipt_price_history 뷰)
--   - 사진·품목 정보는 사장/관리자만 조회
-- =========================================================

create table public.receipts (
  id            bigint generated always as identity primary key,
  photo_paths   text[] not null check (cardinality(photo_paths) between 1 and 3),
  note          text,                                  -- 올린 직원 메모
  created_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  status        text not null default 'processing'
                  check (status in ('processing', 'proposed', 'failed', 'confirmed', 'rejected', 'void')),
  proposal      jsonb,                                 -- AI 제안 (그대로 보관)
  ai_model      text,
  ai_error      text,
  ai_at         timestamptz,
  -- 확정 값
  vendor        text,
  receipt_date  date,
  total_amount  numeric,
  confirmed_by  uuid references public.profiles (id),
  confirmed_at  timestamptz,
  -- 반려 / 무효
  closed_by     uuid references public.profiles (id),
  closed_at     timestamptz,
  close_reason  text
);
create index receipts_status_idx on public.receipts (status, created_at desc);
alter table public.receipts enable row level security;
create policy "receipts_select_admin" on public.receipts
  for select to authenticated using (public.is_admin());
alter publication supabase_realtime add table public.receipts;

create table public.receipt_items (
  id              bigint generated always as identity primary key,
  receipt_id      bigint not null references public.receipts (id),
  line_no         int not null,
  item_name       text not null,
  normalized_name text not null,                       -- 같은 품목 비교용 (공백 제거, 소문자)
  quantity        numeric not null check (quantity > 0),
  unit            text,
  unit_price      numeric not null check (unit_price >= 0),
  line_total      numeric not null check (line_total >= 0),
  created_at      timestamptz not null default now()
);
create index receipt_items_name_idx on public.receipt_items (normalized_name);
alter table public.receipt_items enable row level security;
create policy "receipt_items_select_admin" on public.receipt_items
  for select to authenticated using (public.is_admin());

-- 확정된 품목은 수정·삭제 불가 (틀렸으면 전표 전체를 무효 처리)
create function public.receipt_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '확정된 품목은 수정하거나 삭제할 수 없습니다. 전표를 무효 처리하세요';
end;
$$;
create trigger receipt_items_guard
  before update or delete on public.receipt_items
  for each row execute function public.receipt_items_guard();
revoke execute on function public.receipt_items_guard() from public, anon, authenticated;

-- 전표 상태 흐름만 허용:
--   processing → proposed / failed  (AI 결과, 서버)
--   proposed / failed → processing  (다시 읽기)
--   proposed / failed → confirmed / rejected
--   confirmed → void
create function public.receipts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '전표는 삭제할 수 없습니다';
  end if;
  if new.photo_paths <> old.photo_paths or new.created_by <> old.created_by
     or new.created_at <> old.created_at or new.note is distinct from old.note then
    raise exception '전표 원본 정보는 바꿀 수 없습니다';
  end if;
  if old.status = 'confirmed' and (
       new.vendor is distinct from old.vendor or new.receipt_date is distinct from old.receipt_date
       or new.total_amount is distinct from old.total_amount or new.confirmed_by is distinct from old.confirmed_by
       or new.confirmed_at is distinct from old.confirmed_at) then
    raise exception '확정된 전표는 수정할 수 없습니다. 무효 처리하세요';
  end if;
  if (old.status, new.status) in (
       ('processing', 'proposed'), ('processing', 'failed'),
       ('proposed', 'processing'), ('failed', 'processing'),
       ('proposed', 'confirmed'), ('failed', 'confirmed'),
       ('proposed', 'rejected'), ('failed', 'rejected'), ('processing', 'rejected'),
       ('confirmed', 'void')) then
    return new;
  end if;
  raise exception '전표 상태를 % 에서 % (으)로 바꿀 수 없습니다', old.status, new.status;
end;
$$;
create trigger receipts_guard
  before update or delete on public.receipts
  for each row execute function public.receipts_guard();
revoke execute on function public.receipts_guard() from public, anon, authenticated;

-- ---------- 사진 저장소 (비공개) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-photos', 'receipt-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- 올리기: 사용 중인 직원, 오늘 날짜 폴더
create policy "receipt_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipt-photos'
    and public.is_active_member()
    and (storage.foldername(name))[1] = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD')
  );
-- 보기: 사장/관리자만 (직원은 올린 뒤 볼 수 없음)
create policy "receipt_photos_select_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipt-photos' and public.is_admin());

-- ---------- 직원: 전표 제출 ----------
create function public.submit_receipt(p_paths text[], p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD');
  v_path  text;
  v_id    bigint;
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요합니다';
  end if;
  if p_paths is null or cardinality(p_paths) < 1 or cardinality(p_paths) > 3 then
    raise exception '사진은 1장에서 3장까지 올릴 수 있습니다';
  end if;
  if (select count(distinct p) from unnest(p_paths) p) <> cardinality(p_paths) then
    raise exception '같은 사진이 두 번 들어 있습니다';
  end if;
  foreach v_path in array p_paths loop
    if split_part(v_path, '/', 1) <> v_today or not exists (
      select 1 from storage.objects
      where bucket_id = 'receipt-photos' and name = v_path
        and (owner_id = auth.uid()::text or owner = auth.uid())
    ) then
      raise exception '올라간 사진을 찾을 수 없습니다. 다시 찍어 주세요';
    end if;
  end loop;

  insert into public.receipts (photo_paths, note, created_by)
  values (p_paths, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 사장/관리자: 다시 읽기 / 확정 / 반려 / 무효 ----------
create function public.retry_receipt(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '사장 또는 관리자만 할 수 있습니다';
  end if;
  update public.receipts set status = 'processing', ai_error = null
  where id = p_id and status in ('proposed', 'failed');
  if not found then
    raise exception '다시 읽을 수 있는 전표가 아닙니다';
  end if;
end;
$$;

-- p_items: [{"name": "...", "quantity": 1, "unit": "kg", "unit_price": 1000, "line_total": 1000}, ...]
create function public.confirm_receipt(
  p_id bigint, p_vendor text, p_receipt_date date, p_total numeric, p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_no   int := 0;
  v_name text;
begin
  if not public.is_admin() then
    raise exception '사장 또는 관리자만 확정할 수 있습니다';
  end if;
  perform 1 from public.receipts where id = p_id and status in ('proposed', 'failed') for update;
  if not found then
    raise exception '확정할 수 있는 전표가 아닙니다 (이미 확정·반려되었거나 아직 읽는 중)';
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
    if coalesce((v_item ->> 'quantity')::numeric, 0) <= 0
       or (v_item ->> 'unit_price') is null or (v_item ->> 'line_total') is null then
      raise exception '%번째 품목(%)의 수량·단가·금액을 확인하세요', v_no, v_name;
    end if;
    insert into public.receipt_items
      (receipt_id, line_no, item_name, normalized_name, quantity, unit, unit_price, line_total)
    values (
      p_id, v_no, v_name, lower(regexp_replace(v_name, '\s+', '', 'g')),
      (v_item ->> 'quantity')::numeric,
      nullif(trim(coalesce(v_item ->> 'unit', '')), ''),
      (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'line_total')::numeric
    );
  end loop;

  update public.receipts
  set status = 'confirmed', vendor = trim(p_vendor), receipt_date = p_receipt_date,
      total_amount = p_total, confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_id;
end;
$$;

create function public.close_receipt(p_id bigint, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '사장 또는 관리자만 할 수 있습니다';
  end if;
  if p_status not in ('rejected', 'void') then
    raise exception '잘못된 요청입니다';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception '사유를 입력하세요';
  end if;
  update public.receipts
  set status = p_status, closed_by = auth.uid(), closed_at = now(), close_reason = trim(p_reason)
  where id = p_id
    and ((p_status = 'rejected' and status in ('processing', 'proposed', 'failed'))
      or (p_status = 'void' and status = 'confirmed'));
  if not found then
    raise exception '처리할 수 없는 상태의 전표입니다';
  end if;
end;
$$;

revoke execute on function public.submit_receipt(text[], text) from public, anon;
revoke execute on function public.retry_receipt(bigint) from public, anon;
revoke execute on function public.confirm_receipt(bigint, text, date, numeric, jsonb) from public, anon;
revoke execute on function public.close_receipt(bigint, text, text) from public, anon;
grant execute on function public.submit_receipt(text[], text) to authenticated;
grant execute on function public.retry_receipt(bigint) to authenticated;
grant execute on function public.confirm_receipt(bigint, text, date, numeric, jsonb) to authenticated;
grant execute on function public.close_receipt(bigint, text, text) to authenticated;

-- ---------- 단가 변동: 같은 품목(이름+단위)의 직전 확정 단가와 비교 ----------
create view public.receipt_price_history with (security_invoker = true) as
select
  i.id,
  i.receipt_id,
  r.vendor,
  r.receipt_date,
  r.confirmed_at,
  i.item_name,
  i.normalized_name,
  i.unit,
  i.quantity,
  i.unit_price,
  i.line_total,
  lag(i.unit_price)   over w as prev_unit_price,
  lag(r.receipt_date) over w as prev_receipt_date,
  lag(r.vendor)       over w as prev_vendor
from public.receipt_items i
join public.receipts r on r.id = i.receipt_id and r.status = 'confirmed'
window w as (partition by i.normalized_name, coalesce(i.unit, '') order by r.receipt_date, r.confirmed_at, i.id);
