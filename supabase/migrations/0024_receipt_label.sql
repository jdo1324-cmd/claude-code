-- 전표 이름: 올린 날(한국 시간) + 그날 몇 번째인지 → "10월23일_1". 화면에는 "#10월23일_1"로 보임.
set local lock_timeout = '10s';
alter table public.receipts add column label text;

-- 전표 이름은 한 번 정해지면 바꿀 수 없음. 비어 있던 이름을 채우는 것만 상태 변화 없이 허용.
create or replace function public.receipts_guard()
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
  if new.label is distinct from old.label and old.label is not null then
    raise exception '전표 이름은 바꿀 수 없습니다';
  end if;
  if old.status = 'confirmed' and (
       new.vendor is distinct from old.vendor or new.receipt_date is distinct from old.receipt_date
       or new.total_amount is distinct from old.total_amount or new.confirmed_by is distinct from old.confirmed_by
       or new.confirmed_at is distinct from old.confirmed_at) then
    raise exception '확정된 전표는 수정할 수 없습니다. 무효 처리하세요';
  end if;
  if new.status = old.status and old.label is null and new.label is not null then
    return new;
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

update public.receipts r set label = x.label
from (
  select id,
         to_char(created_at at time zone 'Asia/Seoul', 'FMMM"월"FMDD"일"_')
           || row_number() over (partition by (created_at at time zone 'Asia/Seoul')::date order by created_at, id) as label
  from public.receipts
) x
where x.id = r.id;

create or replace function public.submit_receipt(p_paths text[], p_note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD');
  v_path  text;
  v_id    bigint;
  v_no    int;
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

  -- 같은 날 동시에 올려도 번호가 겹치지 않게
  perform pg_advisory_xact_lock(hashtext('receipt_label:' || v_today));
  select count(*) + 1 into v_no from public.receipts
  where (created_at at time zone 'Asia/Seoul')::date = v_today::date;

  insert into public.receipts (photo_paths, note, created_by, label)
  values (
    p_paths, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
    to_char(now() at time zone 'Asia/Seoul', 'FMMM"월"FMDD"일"_') || v_no
  )
  returning id into v_id;
  return v_id;
end;
$$;
