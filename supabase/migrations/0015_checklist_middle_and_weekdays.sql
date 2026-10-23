-- 0015: 체크리스트에 "미들 업무" 추가 + 항목별로 하는 요일 지정
--   weekdays: 0=일 1=월 … 6=토. 비어 있으면(null) 매일.

alter table public.checklist_items drop constraint checklist_items_phase_check;
alter table public.checklist_items
  add constraint checklist_items_phase_check check (phase in ('open', 'middle', 'close'));

alter table public.checklist_items
  add column weekdays smallint[]
  check (weekdays is null or (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]));

-- 그날(한국 날짜) 해야 하는 항목인지
create function public.checklist_item_applies(p_weekdays smallint[], p_date date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_weekdays is null or extract(dow from p_date)::smallint = any (p_weekdays)
$$;

-- 요일 값 정리: 0~6만, 중복 없이, 7개 모두면 "매일"(null)
create function public.normalize_weekdays(p_weekdays smallint[])
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_weekdays is null or cardinality(p_weekdays) = 0 then null
    when (select count(distinct d) from unnest(p_weekdays) d where d between 0 and 6) = 7 then null
    else (select array_agg(distinct d order by d) from unnest(p_weekdays) d where d between 0 and 6)
  end
$$;

-- ---------- 완료 처리: 오늘 하는 날이 아닌 항목은 막음 ----------
create or replace function public.complete_checklist_item(p_item_id bigint, p_value numeric, p_photo_path text, p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  public.checklist_items;
  v_today text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD');
  v_id    bigint;
begin
  if not public.is_active_member() then
    raise exception '로그인이 필요합니다';
  end if;

  select * into v_item from public.checklist_items where id = p_item_id and is_active;
  if not found then
    raise exception '사용 중인 항목이 아닙니다';
  end if;

  if not public.checklist_item_applies(v_item.weekdays, v_today::date) then
    raise exception '오늘 하는 항목이 아닙니다';
  end if;

  if v_item.item_type = 'number' and p_value is null then
    raise exception '숫자를 입력해야 완료됩니다';
  end if;

  if v_item.item_type = 'photo' then
    if p_photo_path is null or split_part(p_photo_path, '/', 1) <> v_today then
      raise exception '사진을 찍어야 완료됩니다';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'checklist-photos' and name = p_photo_path
        and (owner_id = auth.uid()::text or owner = auth.uid())
    ) then
      raise exception '올라간 사진을 찾을 수 없습니다. 다시 찍어 주세요';
    end if;
  end if;

  insert into public.checklist_entries (item_id, value_number, photo_path, note, done_by)
  values (
    p_item_id,
    case when v_item.item_type = 'number' then p_value end,
    case when v_item.item_type = 'photo' then p_photo_path end,
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception '이미 다른 직원이 완료한 항목입니다. 화면을 새로고침하세요';
end;
$$;

-- ---------- 매출 정산 저장 조건: 그날 하는 마감 필수 항목만 ----------
create or replace function public.missing_required_close_items(p_date date)
returns table (id bigint, category text, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.category, i.title
  from public.checklist_items i
  where i.phase = 'close' and i.is_required and i.is_active
    and public.checklist_item_applies(i.weekdays, p_date)
    and not exists (
      select 1 from public.checklist_entries e
      where e.item_id = i.id and e.work_date = p_date and e.status = 'valid'
    )
  order by i.sort_order
$$;

-- ---------- 항목 추가 / 수정: 요일까지 한 번에 ----------
-- (기존 add_checklist_item / update_checklist_item 은 그대로 두고, 앱은 이 함수를 씀)
-- p_item_id 가 없으면 추가, 있으면 수정. 돌려주는 값은 (새) 항목 id.
create function public.save_checklist_item(
  p_item_id bigint, p_phase text, p_category text, p_title text, p_item_type text, p_unit text,
  p_is_required boolean, p_weekdays smallint[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_items;
  v_unit text := case when p_item_type = 'number' then nullif(trim(coalesce(p_unit, '')), '') end;
  v_days smallint[] := public.normalize_weekdays(p_weekdays);
  v_id bigint;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception '사장만 항목을 관리할 수 있습니다';
  end if;
  if coalesce(trim(p_category), '') = '' or coalesce(trim(p_title), '') = '' then
    raise exception '업무 구분과 항목 이름을 입력하세요';
  end if;
  if p_item_type not in ('check', 'number', 'photo') then
    raise exception '항목 종류가 올바르지 않습니다';
  end if;

  if p_item_id is null then
    if p_phase not in ('open', 'middle', 'close') then
      raise exception '오픈 / 미들 / 마감 중에서 골라 주세요';
    end if;
    insert into public.checklist_items (phase, category, title, item_type, unit, is_required, sort_order, weekdays)
    values (p_phase, trim(p_category), trim(p_title), p_item_type, v_unit, p_is_required,
      coalesce((select max(sort_order) from public.checklist_items where phase = p_phase), 0) + 10, v_days)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_item from public.checklist_items where id = p_item_id for update;
  if not found then
    raise exception '항목을 찾을 수 없습니다';
  end if;

  -- 이미 기록이 있는 항목의 종류를 바꾸면 새 항목으로 (지난 기록 보존)
  if v_item.item_type <> p_item_type
     and exists (select 1 from public.checklist_entries e where e.item_id = p_item_id) then
    update public.checklist_items set is_active = false where id = p_item_id;
    insert into public.checklist_items (phase, category, title, item_type, unit, is_required, sort_order, is_active, weekdays)
    values (v_item.phase, trim(p_category), trim(p_title), p_item_type, v_unit, p_is_required, v_item.sort_order, true, v_days)
    returning id into v_id;
    return v_id;
  end if;

  update public.checklist_items
  set category = trim(p_category), title = trim(p_title), item_type = p_item_type,
      unit = v_unit, is_required = p_is_required, weekdays = v_days
  where id = p_item_id;
  return p_item_id;
end;
$$;
revoke execute on function public.save_checklist_item(bigint, text, text, text, text, text, boolean, smallint[]) from public, anon;
grant execute on function public.save_checklist_item(bigint, text, text, text, text, text, boolean, smallint[]) to authenticated;
