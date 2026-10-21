-- =========================================================
-- 0006: 오픈/마감 체크리스트
--   - 항목 종류: check(체크) / number(숫자 입력) / photo(사진 필수)
--   - 필수/선택 구분
--   - 하루에 항목당 유효한 완료 기록 1건 (여러 명이 같은 체크리스트를 공유)
--   - 기록은 지우지 않음: 잘못 체크하면 "취소(무효)" + 사유
--   - 실시간 반영(Supabase Realtime), 사진은 비공개 저장소
-- =========================================================

create function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;
revoke execute on function public.is_active_member() from public, anon;
grant execute on function public.is_active_member() to authenticated;

-- ---------- 항목 ----------
create table public.checklist_items (
  id          bigint generated always as identity primary key,
  phase       text not null check (phase in ('open', 'close')),          -- 오픈 / 마감
  category    text not null,                                             -- 예: 매장 오픈, 매출 정산
  title       text not null,
  item_type   text not null check (item_type in ('check', 'number', 'photo')),
  unit        text,                                                      -- 숫자 항목 단위 (℃, 원)
  is_required boolean not null default true,
  sort_order  int not null default 0,
  is_active   boolean not null default true,                             -- 항목은 지우지 않고 사용 중지
  created_at  timestamptz not null default now()
);
alter table public.checklist_items enable row level security;
create policy "checklist_items_select_members" on public.checklist_items
  for select to authenticated using (public.is_active_member());

-- ---------- 완료 기록 ----------
create table public.checklist_entries (
  id           bigint generated always as identity primary key,
  work_date    date not null default (now() at time zone 'Asia/Seoul')::date,
  item_id      bigint not null references public.checklist_items (id),
  value_number numeric,
  photo_path   text,
  note         text,
  done_by      uuid not null references public.profiles (id),
  done_at      timestamptz not null default now(),
  status       text not null default 'valid' check (status in ('valid', 'void')),
  voided_by    uuid references public.profiles (id),
  voided_at    timestamptz,
  void_reason  text
);
create unique index checklist_entries_one_valid on public.checklist_entries (work_date, item_id) where status = 'valid';
create index checklist_entries_date_idx on public.checklist_entries (work_date);
alter table public.checklist_entries enable row level security;
create policy "checklist_entries_select_members" on public.checklist_entries
  for select to authenticated using (public.is_active_member());

-- 실시간 반영: 다른 직원 화면에 바로 보이도록
alter publication supabase_realtime add table public.checklist_entries;

-- 기록 보호: 삭제 금지, "유효 → 취소(무효)" 외 수정 금지
create function public.checklist_entry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '체크리스트 기록은 삭제할 수 없습니다';
  end if;
  if old.status = 'valid' and new.status = 'void'
     and new.work_date = old.work_date and new.item_id = old.item_id
     and new.value_number is not distinct from old.value_number
     and new.photo_path is not distinct from old.photo_path
     and new.note is not distinct from old.note
     and new.done_by = old.done_by and new.done_at = old.done_at then
    new.voided_at := coalesce(new.voided_at, now());
    return new;
  end if;
  raise exception '체크리스트 기록은 수정할 수 없습니다. 취소 후 다시 체크하세요';
end;
$$;
create trigger checklist_entries_guard
  before update or delete on public.checklist_entries
  for each row execute function public.checklist_entry_guard();
revoke execute on function public.checklist_entry_guard() from public, anon, authenticated;

-- ---------- 사진 저장소 (비공개) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checklist-photos', 'checklist-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

-- 올리기: 사용 중인 직원만, 오늘 날짜 폴더에만 (지난 날짜로 사진을 끼워 넣지 못하게)
create policy "checklist_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checklist-photos'
    and public.is_active_member()
    and (storage.foldername(name))[1] = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD')
  );
-- 보기: 사용 중인 직원만. 수정/삭제 정책은 없음 = 불가
create policy "checklist_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'checklist-photos' and public.is_active_member());

-- ---------- 완료 처리 ----------
create function public.complete_checklist_item(p_item_id bigint, p_value numeric, p_photo_path text, p_note text)
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

-- ---------- 취소(무효) ----------
-- 본인이 오늘 체크한 것, 또는 사장/관리자
create function public.void_checklist_entry(p_entry_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.checklist_entries;
begin
  select * into v_entry from public.checklist_entries where id = p_entry_id and status = 'valid' for update;
  if not found then
    raise exception '이미 취소되었거나 없는 기록입니다';
  end if;
  if not (
    public.is_admin()
    or (v_entry.done_by = auth.uid() and v_entry.work_date = (now() at time zone 'Asia/Seoul')::date)
  ) then
    raise exception '본인이 오늘 체크한 항목만 취소할 수 있습니다. 사장님이나 관리자에게 요청하세요';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception '취소 사유를 입력하세요';
  end if;

  update public.checklist_entries
  set status = 'void', voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = p_entry_id;
end;
$$;

-- ---------- 항목 관리 (사장) ----------
create function public.add_checklist_item(
  p_phase text, p_category text, p_title text, p_item_type text, p_unit text, p_is_required boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception '사장만 항목을 관리할 수 있습니다';
  end if;
  if coalesce(trim(p_category), '') = '' or coalesce(trim(p_title), '') = '' then
    raise exception '업무 구분과 항목 이름을 입력하세요';
  end if;
  insert into public.checklist_items (phase, category, title, item_type, unit, is_required, sort_order)
  values (
    p_phase, trim(p_category), trim(p_title), p_item_type,
    case when p_item_type = 'number' then nullif(trim(coalesce(p_unit, '')), '') end,
    p_is_required,
    coalesce((select max(sort_order) from public.checklist_items where phase = p_phase), 0) + 10
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.set_checklist_item_active(p_item_id bigint, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_role() is distinct from 'owner' then
    raise exception '사장만 항목을 관리할 수 있습니다';
  end if;
  update public.checklist_items set is_active = p_active where id = p_item_id;
end;
$$;

revoke execute on function public.complete_checklist_item(bigint, numeric, text, text) from public, anon;
revoke execute on function public.void_checklist_entry(bigint, text) from public, anon;
revoke execute on function public.add_checklist_item(text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.set_checklist_item_active(bigint, boolean) from public, anon;
grant execute on function public.complete_checklist_item(bigint, numeric, text, text) to authenticated;
grant execute on function public.void_checklist_entry(bigint, text) to authenticated;
grant execute on function public.add_checklist_item(text, text, text, text, text, boolean) to authenticated;
grant execute on function public.set_checklist_item_active(bigint, boolean) to authenticated;

-- ---------- 기본 항목 (사장이 관리 화면에서 추가/사용 중지 가능) ----------
insert into public.checklist_items (phase, category, title, item_type, unit, is_required, sort_order) values
  ('open',  '매장 오픈',       '출입문·조명·간판 켜기',        'check',  null, true,  10),
  ('open',  '매장 오픈',       '냉장고 온도',                  'number', '℃',  true,  20),
  ('open',  '매장 오픈',       '냉동고 온도',                  'number', '℃',  true,  30),
  ('open',  '매장 오픈',       '홀 테이블·수저 세팅',          'check',  null, false, 40),
  ('open',  '청소 상태 확인',  '홀 바닥·테이블 청결 상태',     'photo',  null, true,  50),
  ('open',  '청소 상태 확인',  '화장실 청결 상태',             'photo',  null, false, 60),
  ('close', '매출 정산',       '포스 매출 마감 금액',          'number', '원', true,  10),
  ('close', '매출 정산',       '현금 시재 금액',               'number', '원', true,  20),
  ('close', '매출 정산',       '정산 영수증',                  'photo',  null, true,  30),
  ('close', '마감 청소',       '주방 청소 완료 상태',          'photo',  null, true,  40),
  ('close', '마감 청소',       '홀 청소',                      'check',  null, true,  50),
  ('close', '마감 청소',       '음식물 쓰레기 처리',           'check',  null, false, 60),
  ('close', '가스·전기 차단',  '가스 밸브 잠금',               'photo',  null, true,  70),
  ('close', '가스·전기 차단',  '주방 기기 전원 차단',          'check',  null, true,  80),
  ('close', '가스·전기 차단',  '출입문 잠금',                  'check',  null, true,  90);
