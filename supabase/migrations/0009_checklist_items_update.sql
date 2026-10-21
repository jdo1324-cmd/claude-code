-- 0009: 사장님 요청으로 체크리스트 항목 조정 (항목은 지우지 않고 사용 중지/다시 사용)
--   오픈 업무: "청소 상태 확인"만 사용 ("매장 오픈" 업무 사용 중지)
--   마감 > 매출 정산: 숫자 입력 항목으로 (정산 영수증 사진 항목 사용 중지)

update public.checklist_items set is_active = false
where phase = 'open' and category = '매장 오픈';

update public.checklist_items set is_active = true
where phase = 'close' and category = '매출 정산' and title in ('포스 매출 마감 금액', '현금 시재 금액');

update public.checklist_items set is_active = false
where phase = 'close' and category = '매출 정산' and title = '정산 영수증';
