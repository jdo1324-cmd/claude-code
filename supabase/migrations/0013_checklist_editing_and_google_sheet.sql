-- 0013: 사장님이 체크리스트 항목을 직접 고치는 기능 + 전표를 구글 시트로 보내는 기능

-- ---------- 체크리스트 항목 수정 ----------
-- 이름·업무 구분·필수 여부·단위는 그 자리에서 바꿈.
-- 종류(체크/숫자/사진)를 바꾸는데 이미 완료 기록이 있으면, 지난 기록이 망가지지 않도록
-- 같은 자리에 새 항목을 만들고 기존 항목은 사용 중지함. 돌려주는 값은 (새) 항목 id.
create function public.update_checklist_item(
  p_item_id bigint,
  p_category text,
  p_title text,
  p_item_type text,
  p_unit text,
  p_is_required boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_items;
  v_unit text;
  v_new_id bigint;
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

  select * into v_item from public.checklist_items where id = p_item_id for update;
  if not found then
    raise exception '항목을 찾을 수 없습니다';
  end if;

  v_unit := case when p_item_type = 'number' then nullif(trim(coalesce(p_unit, '')), '') end;

  if v_item.item_type <> p_item_type
     and exists (select 1 from public.checklist_entries e where e.item_id = p_item_id) then
    update public.checklist_items set is_active = false where id = p_item_id;
    insert into public.checklist_items (phase, category, title, item_type, unit, is_required, sort_order, is_active)
    values (v_item.phase, trim(p_category), trim(p_title), p_item_type, v_unit, p_is_required, v_item.sort_order, true)
    returning id into v_new_id;
    return v_new_id;
  end if;

  update public.checklist_items
  set category = trim(p_category),
      title = trim(p_title),
      item_type = p_item_type,
      unit = v_unit,
      is_required = p_is_required
  where id = p_item_id;
  return p_item_id;
end;
$$;

-- 순서 바꾸기: 같은 오픈/마감 안에서 바로 위(-1) 또는 아래(+1) 항목과 자리를 바꿈
create function public.move_checklist_item(p_item_id bigint, p_direction int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_items;
  v_other public.checklist_items;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception '사장만 항목을 관리할 수 있습니다';
  end if;
  select * into v_item from public.checklist_items where id = p_item_id;
  if not found then
    raise exception '항목을 찾을 수 없습니다';
  end if;

  -- 순서 값이 겹치지 않게 먼저 10, 20, 30 … 으로 다시 매김 (보이는 순서는 그대로)
  update public.checklist_items i
  set sort_order = r.rn * 10
  from (
    select id, row_number() over (order by sort_order, id) as rn
    from public.checklist_items where phase = v_item.phase
  ) r
  where i.id = r.id;
  select * into v_item from public.checklist_items where id = p_item_id;

  if p_direction < 0 then
    select * into v_other from public.checklist_items
    where phase = v_item.phase and is_active and sort_order < v_item.sort_order
    order by sort_order desc limit 1;
  else
    select * into v_other from public.checklist_items
    where phase = v_item.phase and is_active and sort_order > v_item.sort_order
    order by sort_order limit 1;
  end if;
  if not found then
    return; -- 이미 맨 위/맨 아래
  end if;

  update public.checklist_items set sort_order = v_other.sort_order where id = v_item.id;
  update public.checklist_items set sort_order = v_item.sort_order where id = v_other.id;
end;
$$;

revoke execute on function public.update_checklist_item(bigint, text, text, text, text, boolean) from public, anon;
revoke execute on function public.move_checklist_item(bigint, int) from public, anon;
grant execute on function public.update_checklist_item(bigint, text, text, text, text, boolean) to authenticated;
grant execute on function public.move_checklist_item(bigint, int) to authenticated;

-- ---------- 구글 시트 연결 ----------
-- 사장님 구글 시트에 붙인 Apps Script 주소와 비밀값. 서버(비밀 키)에서만 읽고 씀.
create table public.google_sheet_settings (
  id          int primary key default 1 check (id = 1),
  webhook_url text,
  secret      text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);
alter table public.google_sheet_settings enable row level security;
-- 정책 없음: 로그인한 사용자도 직접 읽을 수 없음 (비밀값 보호)
insert into public.google_sheet_settings (id) values (1);

-- 전표를 시트로 보낸 기록 (다시 보내면 줄이 하나 더 쌓임)
create table public.receipt_sheet_exports (
  id         bigint generated always as identity primary key,
  receipt_id bigint not null references public.receipts (id),
  sent_by    uuid not null references public.profiles (id),
  sent_at    timestamptz not null default now()
);
create index receipt_sheet_exports_receipt_idx on public.receipt_sheet_exports (receipt_id, sent_at desc);
alter table public.receipt_sheet_exports enable row level security;
create policy "receipt_sheet_exports_select_admin" on public.receipt_sheet_exports
  for select to authenticated using (public.is_admin());
