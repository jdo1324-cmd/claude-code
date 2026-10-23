-- 전표는 한 번에 사진 1장만 (여러 장짜리 전표는 장마다 따로 올림)
set local lock_timeout = '10s';
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
  if p_paths is null or cardinality(p_paths) <> 1 then
    raise exception '전표 사진은 한 번에 1장씩 올려 주세요';
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
