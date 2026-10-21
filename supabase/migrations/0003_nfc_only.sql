-- 0003: 매장 와이파이(IP) 제한 제거. 출퇴근은 NFC 태그로만.
alter table public.store_settings
  drop column require_store_network,
  drop column allowed_ips;
