-- 전표: 올린 사람이 직접 확인·확정 + 매장 매출 매입 장부 품목 연결
set local lock_timeout = '10s';

-- ---------- 올린 사람은 자기 전표·사진·품목을 볼 수 있음 ----------
create policy "receipts_select_own" on public.receipts
  for select to authenticated using (created_by = auth.uid());
create policy "receipt_items_select_own" on public.receipt_items
  for select to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_id and r.created_by = auth.uid()));
create policy "receipt_photos_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipt-photos' and owner_id = auth.uid()::text);
create policy "receipt_sheet_exports_select_own" on public.receipt_sheet_exports
  for select to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_id and r.created_by = auth.uid()));

-- ---------- 장부 품목 ----------
alter table public.receipt_items add column ledger_item text;

-- 장부(매장 매출 매입 장부)의 품목 목록. 구역(축산·야채·프레시원 …) + 품목 이름. 구글 시트에서 다시 불러올 수 있음.
create table public.ledger_items (
  id          bigint generated always as identity primary key,
  section     text not null,
  name        text not null,
  sort_order  int not null default 0,
  unique (section, name)
);
alter table public.ledger_items enable row level security;
create policy "ledger_items_select_member" on public.ledger_items
  for select to authenticated using (public.is_active_member());

alter table public.google_sheet_settings
  add column ledger_file_id text default '11E6fNKVuRwdw0MgDsFfc5pR3YlXfyYZAKP77uUpDMfg';
update public.google_sheet_settings set ledger_file_id = '11E6fNKVuRwdw0MgDsFfc5pR3YlXfyYZAKP77uUpDMfg'
  where ledger_file_id is null;

-- ---------- 확정 · 다시 읽기 · 반려: 사장/관리자 또는 올린 사람 ----------
create or replace function public.confirm_receipt(p_id bigint, p_vendor text, p_receipt_date date, p_total numeric, p_items jsonb)
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
    if coalesce((v_item ->> 'quantity')::numeric, 0) <= 0
       or (v_item ->> 'unit_price') is null or (v_item ->> 'line_total') is null then
      raise exception '%번째 품목(%)의 수량·단가·금액을 확인하세요', v_no, v_name;
    end if;
    insert into public.receipt_items
      (receipt_id, line_no, item_name, normalized_name, quantity, unit, unit_price, line_total, ledger_item)
    values (
      p_id, v_no, v_name, lower(regexp_replace(v_name, '\s+', '', 'g')),
      (v_item ->> 'quantity')::numeric,
      nullif(trim(coalesce(v_item ->> 'unit', '')), ''),
      (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'line_total')::numeric,
      nullif(trim(coalesce(v_item ->> 'ledger_item', '')), '')
    );
  end loop;

  update public.receipts
  set status = 'confirmed', vendor = trim(p_vendor), receipt_date = p_receipt_date,
      total_amount = p_total, confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_id;
end;
$$;

create or replace function public.retry_receipt(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.receipts set status = 'processing', ai_error = null
  where id = p_id and status in ('proposed', 'failed') and (public.is_admin() or created_by = auth.uid());
  if not found then
    raise exception '다시 읽을 수 있는 전표가 아닙니다';
  end if;
end;
$$;

-- 반려(확정 전)는 올린 사람도, 무효(확정 후)는 사장/관리자만
create or replace function public.close_receipt(p_id bigint, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('rejected', 'void') then
    raise exception '잘못된 요청입니다';
  end if;
  if p_status = 'void' and not public.is_admin() then
    raise exception '무효 처리는 사장 또는 관리자만 할 수 있습니다';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception '사유를 입력하세요';
  end if;
  update public.receipts
  set status = p_status, closed_by = auth.uid(), closed_at = now(), close_reason = trim(p_reason)
  where id = p_id
    and (public.is_admin() or created_by = auth.uid())
    and ((p_status = 'rejected' and status in ('processing', 'proposed', 'failed'))
      or (p_status = 'void' and status = 'confirmed'));
  if not found then
    raise exception '처리할 수 없는 상태의 전표입니다';
  end if;
end;
$$;

-- ---------- 장부 품목 처음 목록 (26년10월 시트 기준) ----------
insert into public.ledger_items (section, name, sort_order) values
  ('축산', 'BBQ갈비 (미국산)', 1),
  ('축산', '홍두께살 (육회, 호주)', 2),
  ('축산', '홍두께살 (육전 2mm)', 3),
  ('축산', '전각 (다짐육)', 4),
  ('축산', '삼겹살', 5),
  ('축산', '목살', 6),
  ('야채', '다진마늘', 7),
  ('야채', '새송이버섯', 8),
  ('야채', '홍고추', 9),
  ('야채', '청양고추', 10),
  ('야채', '상추', 11),
  ('야채', '당근', 12),
  ('야채', '오이', 13),
  ('야채', '배', 14),
  ('야채', '적양배추', 15),
  ('야채', '쪽파', 16),
  ('야채', '대파', 17),
  ('야채', '감자', 18),
  ('야채', '쌀', 19),
  ('야채', '양파', 20),
  ('야채', '국내산김치', 21),
  ('야채', '두부', 22),
  ('야채', '애호박', 23),
  ('야채', '무', 24),
  ('야채', '자른미역', 25),
  ('프레시원', '진간장', 26),
  ('프레시원', '미림', 27),
  ('프레시원', '고추가루', 28),
  ('프레시원', '물회소스', 29),
  ('프레시원', '냉면김치', 30),
  ('프레시원', '단무지', 31),
  ('프레시원', '볶음깨', 32),
  ('프레시원', '피자치즈', 33),
  ('프레시원', '궁채', 34),
  ('프레시원', '짜사이', 35),
  ('프레시원', '무말랭이', 36),
  ('프레시원', '기타', 37),
  ('서울제면', '밀면', 38),
  ('서울제면', '육수', 39),
  ('서울제면', '비빔장', 40),
  ('네이버 식재료', '물엿', 41),
  ('네이버 식재료', '설탕', 42),
  ('네이버 식재료', '고추가루', 43),
  ('네이버 식재료', '마늘후레이크', 44),
  ('네이버 식재료', '튀김가루', 45),
  ('네이버 식재료', '파슬리', 46),
  ('네이버 식재료', '김치 시즈닝', 47),
  ('네이버 식재료', '후리가케', 48),
  ('네이버 식재료', '참기름', 49),
  ('네이버 식재료', '소면', 50),
  ('네이버 식재료', '빵가루', 51),
  ('네이버 식재료', '비빔밥 고추장', 52),
  ('네이버 식재료', '치즈', 53),
  ('네이버 식재료', '날치알', 54),
  ('네이버 식재료', '춘장', 55),
  ('네이버 식재료', '떡', 56),
  ('네이버 식재료', '토마토소스', 57),
  ('네이버 식재료', '된장가루', 58),
  ('네이버 식재료', '쯔유', 59),
  ('네이버 식재료', '파절이소스', 60),
  ('네이버 식재료', '궁채장아찌', 61),
  ('네이버 식재료', '짜사이', 62),
  ('네이버 식재료', '무말랭이', 63),
  ('네이버 기타', '기타 물품 소계', 64),
  ('네이버 기타', '갈비찜 그릇', 65),
  ('네이버 기타', '비빔밥,물회,밀면 그릇', 66),
  ('네이버 기타', '전 그릇', 67),
  ('계란', '계란', 68),
  ('식용유', '식용유', 69),
  ('주류', '막걸리', 70),
  ('주류', '맥주', 71),
  ('주류', '소주', 72),
  ('음료', '제로콜라', 73),
  ('음료', '콜라', 74),
  ('음료', '스프라이트', 75),
  ('기타', '물티슈', 76),
  ('기타', '종이컵', 77),
  ('기타', '티슈', 78),
  ('기타', '75L 종량제', 79),
  ('기타', '10L 종량제', 80),
  ('기타', '불용성마대', 81),
  ('기타', '60L 음식물쓰레기', 82),
  ('기타', '20L 음식물쓰레기', 83),
  ('기타', '식기세척기 세제', 84),
  ('기타', '식기세척기 린스', 85),
  ('기타', '알바 공고', 86),
  ('기타', '직원 식사 및 간식', 87),
  ('기타', '기타', 88),
  ('CPC 충전', 'CPC 충전', 89),
  ('기타 광고', '인스타', 90),
  ('기타 광고', '스마트블럭', 91),
  ('기타 광고', '리워드', 92),
  ('기타 광고', '체험단', 93),
  ('기타 광고', '리뷰', 94),
  ('맥반 지출', '직원 식사 및 간식', 95),
  ('맥반 지출', '기타', 96)
on conflict (section, name) do nothing;
