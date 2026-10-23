import 'server-only'
import { ATTENDANCE_SELECT, monthRange, netMinutes, type AttendanceRecord } from '@/lib/attendance'
import { createAdminClient } from '@/lib/supabase/admin'

// 사장님 구글 시트로 보냄. 손익계산서에 붙여 넣은 Apps Script(웹 앱) 하나가 받아서
// 인건비는 손익계산서에, 전표는 "매장 매출 매입 장부" 파일(ledger_file_id)에 씀. 사진은 보내지 않음.

export type SheetSettings = { webhook_url: string | null; secret: string; ledger_file_id: string | null }

// Apps Script 웹 앱 주소만 허용 (다른 곳으로 전표가 새지 않게)
const WEBHOOK_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/

export function isValidWebhookUrl(url: string) {
  return WEBHOOK_PATTERN.test(url)
}

export async function getSheetSettings(): Promise<SheetSettings> {
  const { data, error } = await createAdminClient()
    .from('google_sheet_settings')
    .select('webhook_url, secret, ledger_file_id')
    .eq('id', 1)
    .single()
  if (error || !data) throw new Error('구글 시트 설정을 불러오지 못했습니다')
  return data as SheetSettings
}

type ScriptReply = { ok: boolean; error?: string; sheetName?: string; url?: string; ledgerName?: string | null }

async function callScript(settings: SheetSettings, payload: Record<string, unknown>): Promise<ScriptReply> {
  if (!settings.webhook_url || !isValidWebhookUrl(settings.webhook_url)) {
    return { ok: false, error: '구글 시트가 아직 연결되지 않았습니다. [구글 시트 연결] 화면에서 먼저 연결해 주세요.' }
  }
  let res: Response
  try {
    // Apps Script는 응답을 다른 주소로 넘겨줌(302) → fetch가 따라가서 결과를 받음
    res = await fetch(settings.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, secret: settings.secret }),
      redirect: 'follow',
      signal: AbortSignal.timeout(90_000),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, error: '구글 시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as ScriptReply
  } catch {
    return {
      ok: false,
      error:
        '구글 시트가 응답하지 않았습니다. Apps Script를 "웹 앱"으로 배포했는지, 액세스 권한이 "모든 사용자"인지 확인해 주세요.',
    }
  }
}

// 손익계산서(코드를 붙여 넣은 파일)와 매장 매출 매입 장부를 둘 다 열어 봄
export async function testConnection() {
  const settings = await getSheetSettings()
  return callScript(settings, { type: 'ping', ledgerId: settings.ledger_file_id })
}

export type ReceiptReply = ScriptReply & {
  tab?: string
  created?: boolean
  written?: string[]
  skipped?: string[]
  noPrice?: string[]
}

type ItemRow = {
  item_name: string
  quantity: number
  unit: string | null
  line_total: number
  ledger_item: string | null
}

// 확정된 전표 1건을 장부에 씀 (다시 보내면 예전에 더한 금액을 빼고 다시 씀). undoOnly: 무효 처리 때 빼기만.
export async function sendReceiptToSheet(
  receiptId: number,
  sentBy: string,
  { undoOnly = false }: { undoOnly?: boolean } = {},
): Promise<ReceiptReply> {
  const admin = createAdminClient()
  const settings = await getSheetSettings()
  if (!settings.ledger_file_id) return { ok: false, error: '매장 매출 매입 장부 파일이 지정되지 않았습니다.' }

  const { data: receipt } = await admin
    .from('receipts')
    .select('status, receipt_date, vendor')
    .eq('id', receiptId)
    .maybeSingle()
  if (!receipt) return { ok: false, error: '전표를 찾을 수 없습니다.' }
  if (!undoOnly && receipt.status !== 'confirmed') return { ok: false, error: '확정된 전표만 장부로 보낼 수 있습니다.' }

  const { data: itemData } = await admin
    .from('receipt_items')
    .select('item_name, quantity, unit, line_total, ledger_item')
    .eq('receipt_id', receiptId)
    .order('line_no')
  const items = (itemData ?? []) as ItemRow[]

  const reply = (await callScript(settings, {
    type: 'receipt',
    ledgerId: settings.ledger_file_id,
    id: receiptId,
    date: receipt.receipt_date,
    vendor: receipt.vendor,
    undoOnly,
    lines: items.map((it) => ({
      ledger: it.ledger_item,
      receiptName: it.item_name,
      quantity: Number(it.quantity),
      unit: it.unit,
      amount: Number(it.line_total),
    })),
  })) as ReceiptReply

  if (reply.ok && !undoOnly) {
    await admin.from('receipt_sheet_exports').insert({ receipt_id: receiptId, sent_by: sentBy })
  }
  return reply
}

// 장부의 품목 목록을 다시 불러와 앱의 "장부 품목" 고르기 목록을 새로 고침
export async function refreshLedgerItems() {
  const settings = await getSheetSettings()
  const reply = (await callScript(settings, {
    type: 'ledger_items',
    ledgerId: settings.ledger_file_id,
  })) as ScriptReply & {
    tab?: string
    items?: { section: string; name: string }[]
  }
  if (!reply.ok || !reply.items?.length) return { ok: false, error: reply.error ?? '장부에서 품목을 찾지 못했습니다.' }
  const admin = createAdminClient()
  const seen = new Set<string>()
  const rows = reply.items
    .filter((it) => {
      const key = `${it.section}|${it.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((it, i) => ({ section: it.section, name: it.name, sort_order: i + 1 }))
  const { error: delError } = await admin.from('ledger_items').delete().gte('id', 0)
  if (delError) return { ok: false, error: delError.message }
  const { error } = await admin.from('ledger_items').insert(rows)
  if (error) return { ok: false, error: error.message }
  return { ok: true, tab: reply.tab, count: rows.length }
}

export type LaborReply = ScriptReply & {
  tab?: string
  created?: boolean
  written?: string[]
  added?: string[]
  unmatched?: string[]
}

// 앱 기록이 처음 생긴 날 (그 전 날짜 칸은 사장님이 직접 적은 값이라 건드리지 않음)
export async function firstAttendanceDate() {
  const { data } = await createAdminClient()
    .from('attendance')
    .select('work_date')
    .order('work_date')
    .limit(1)
    .maybeSingle()
  return (data?.work_date as string | undefined) ?? null
}

// 그 달에 시트로 보낼 날짜 범위. 앱 기록이 없는 달이면 null.
export function laborRange(month: string, firstDate: string | null, today: string) {
  const { start, end } = monthRange(month)
  if (!firstDate || firstDate > end || start > today) return null
  const from = firstDate > start ? firstDate : start
  const to = end < today ? end : today
  return { fromDay: Number(from.slice(8)), toDay: Number(to.slice(8)) }
}

// 월별 출퇴근 기록 → "N월 인건비" 탭 날짜 칸
// 정직원: 출근한 날 "출근" (조퇴 기준을 정하면 그보다 짧게 일한 날은 근무시간 숫자)
// 아르바이트: 그날 실근무 시간 (휴게 제외, 소수점 둘째 자리)
export async function sendLaborToSheet(
  month: string,
  earlyLeaveHours: number | null,
  sentBy: string,
  today: string,
): Promise<LaborReply> {
  const admin = createAdminClient()
  const range = laborRange(month, await firstAttendanceDate(), today)
  if (!range) return { ok: false, error: '이 달에는 앱 출퇴근 기록이 없습니다.' }
  const { start, end } = monthRange(month)

  const [{ data: profileData }, { data: recordData }] = await Promise.all([
    admin.from('profiles').select('id, full_name, employment_type, is_active'),
    admin
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('status', 'valid')
      .gte('work_date', start)
      .lte('work_date', end),
  ])
  const records = (recordData ?? []) as unknown as AttendanceRecord[]
  const staff = (
    (profileData ?? []) as { id: string; full_name: string; employment_type: string; is_active: boolean }[]
  )
    .map((p) => {
      const mine = records.filter((r) => r.user_id === p.id)
      const hourly = p.employment_type === 'part_time'
      const days: Record<string, string | number> = {}
      for (const r of mine) {
        const day = Number(r.work_date.slice(8))
        if (day < range.fromDay || day > range.toDay) continue
        const net = netMinutes(r)
        const hours = net === null ? null : Math.round((net / 60) * 100) / 100
        if (hourly) {
          if (hours !== null) days[String(day)] = hours // 근무 중인 기록은 끝난 뒤에 보냄
        } else {
          days[String(day)] = earlyLeaveHours && hours !== null && hours < earlyLeaveHours ? hours : '출근'
        }
      }
      return {
        name: p.full_name.trim(),
        section: hourly ? 'hourly' : 'monthly',
        days,
        keep: p.is_active || mine.length > 0,
      }
    })
    .filter((s) => s.keep)
    .map(({ keep: _keep, ...s }) => s)

  const [year, mon] = month.split('-').map(Number)
  const reply = (await callScript(await getSheetSettings(), {
    type: 'labor',
    year,
    month: mon,
    tabName: `${mon}월 인건비`,
    templateName: 'X월 인건비',
    fromDay: range.fromDay,
    toDay: range.toDay,
    staff,
  })) as LaborReply

  if (reply.ok) {
    await admin
      .from('labor_sheet_exports')
      .insert({ month, sent_by: sentBy, from_day: range.fromDay, to_day: range.toDay })
  }
  return reply
}

// 일용직 근무 기록 → "N월 인건비" 탭의 일용직 구역
// 날짜 칸에 근무시간만 (셀 메모는 넣지 않음). 앱에서 지운 기록의 칸은 비움.
export async function sendDayLaborToSheet(month: string, sentBy: string) {
  const admin = createAdminClient()
  const { start, end } = monthRange(month)
  const { data } = await admin
    .from('day_labor_entries')
    .select('work_date, worker_name, hours, status')
    .gte('work_date', start)
    .lte('work_date', end)
  const rows = (data ?? []) as {
    work_date: string
    worker_name: string
    hours: number
    status: 'valid' | 'void'
  }[]
  if (rows.length === 0) return { ok: false, error: '이 달에는 일용직 기록이 없습니다.' } as LaborReply

  const workers = new Map<string, Record<string, { hours: number; note: string } | null>>()
  for (const r of rows) {
    const name = r.worker_name.trim()
    const day = String(Number(r.work_date.slice(8)))
    const days = workers.get(name) ?? {}
    workers.set(name, days)
    if (r.status === 'void') {
      if (!(day in days)) days[day] = null // 지운 기록 → 그 칸 비움 (같은 날 유효한 기록이 있으면 아래에서 덮어씀)
      continue
    }
    // 메모는 빈 값으로 보냄 → 시트에 붙여 둔 Apps Script가 예전에 넣은 셀 메모도 지움
    days[day] = { hours: Number(r.hours) + (days[day]?.hours ?? 0), note: '' }
  }

  const [year, mon] = month.split('-').map(Number)
  const reply = (await callScript(await getSheetSettings(), {
    type: 'day_labor',
    year,
    month: mon,
    tabName: `${mon}월 인건비`,
    templateName: 'X월 인건비',
    workers: [...workers].map(([name, days]) => ({ name, days })),
  })) as LaborReply
  if (reply.ok) await admin.from('day_labor_sheet_exports').insert({ month, sent_by: sentBy })
  return reply
}

// 일용직 주민번호 → 그 달 인건비 탭 일용직 구역의 주민번호 칸에 바로 적음. 앱에는 저장하지 않음.
export async function sendDayLaborRrnToSheet(month: string, name: string, rrn: string) {
  const [year, mon] = month.split('-').map(Number)
  return (await callScript(await getSheetSettings(), {
    type: 'day_labor_rrn',
    year,
    month: mon,
    tabName: `${mon}월 인건비`,
    templateName: 'X월 인건비',
    name,
    rrn,
  })) as LaborReply
}

// 사장님이 구글 시트에 붙여 넣을 Apps Script 코드 (비밀값이 들어 있음)
export function appsScriptSource(secret: string, ledgerId: string | null) {
  return `// 매장 운영 관리 앱 → 손익계산서(인건비) · 매장 매출 매입 장부(전표)
// 이 코드는 그대로 붙여 넣으세요. 아래 비밀값은 바꾸지 마세요.
const SECRET = '${secret}';

// 처음 한 번: 위 메뉴에서 이 함수를 고르고 ▶ 실행 → "매장 매출 매입 장부" 파일에 쓸 권한을 허용
function checkLedgerAccess() {
  Logger.log('장부 연결 확인: ' + SpreadsheetApp.openById('${ledgerId ?? ''}').getName());
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return reply({ ok: false, error: '비밀값이 맞지 않습니다. 앱의 [구글 시트 연결] 화면에서 코드를 다시 복사해 붙여 넣으세요.' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (body.type === 'ping') {
    let ledgerName = null;
    try { ledgerName = SpreadsheetApp.openById(body.ledgerId).getName(); } catch (err) {}
    return reply({ ok: true, sheetName: ss.getName(), url: ss.getUrl(), ledgerName: ledgerName });
  }
  if (body.type === 'labor') return reply(writeLabor(ss, body));
  if (body.type === 'day_labor') return reply(writeDayLabor(ss, body));
  if (body.type === 'day_labor_rrn') return reply(writeDayLaborRrn(ss, body));
  if (body.type === 'receipt') return reply(writeReceipt(body));
  if (body.type === 'ledger_items') return reply(readLedgerItems(body));
  return reply({ ok: false, error: '알 수 없는 요청' });
}

// ---------- 전표 → 매장 매출 매입 장부 ----------
// 전표 날짜의 "YY년M월" 탭에서 (장부 품목 줄) × (날짜 칸)을 찾아 금액을 더함.
// 더한 내역은 "앱 전표 기록" 탭에 남겨서, 같은 전표를 다시 보내거나 무효로 하면 예전에 더한 금액을 먼저 뺌.
// 평균단가: "단가 기록" 탭에 품목마다 한 줄씩 쓰고, "평균단가" 탭의 B(평균 단가)·C(kg 단가) 칸에 기록을 모아 계산하는 수식을 넣음.
// 평균단가 탭에서 크기별로 나눈 품목(감자 10kg · 감자 20kg)은 전표 품목명의 크기로 고르고, "(종합)" 줄은 그 평균.
const LEDGER_LOG = '앱 전표 기록';
const PRICE_LOG = '단가 기록';
const PRICE_TAB = '평균단가';
const MONTH_TEMPLATE = 'XX년X월';

function writeReceipt(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let ss;
    try {
      ss = SpreadsheetApp.openById(body.ledgerId);
    } catch (err) {
      return { ok: false, error: '"매장 매출 매입 장부" 파일을 열지 못했습니다. Apps Script를 다시 배포하면서 권한을 허용했는지 확인해 주세요.' };
    }
    undoReceipt(ss, body.id);
    const result = { ok: true, sheetName: ss.getName(), url: ss.getUrl(), tab: '', created: false, written: [], skipped: [], noPrice: [] };
    if (body.undoOnly) return result;

    const d = String(body.date).split('-').map(Number);
    const t = monthTab(ss, d[0], d[1]);
    if (t.error) return { ok: false, error: t.error };
    const sh = t.sh;
    result.tab = sh.getName();
    result.created = t.created;
    const head = sh.getRange(4, 1, 1, sh.getLastColumn()).getValues()[0];
    let col = -1;
    head.forEach(function (v, i) {
      if (v instanceof Date && v.getFullYear() === d[0] && v.getMonth() + 1 === d[1] && v.getDate() === d[2]) col = i + 1;
    });
    if (col === -1) return { ok: false, error: '"' + sh.getName() + '" 탭 4번째 줄에서 ' + body.date + ' 날짜 칸을 찾지 못했습니다.' };

    const rows = ledgerRows(sh);
    const log = getSheet(ss, LEDGER_LOG, ['전표번호', '탭', '칸', '더한 금액', '품목', '보낸 시각']);
    const plog = getSheet(ss, PRICE_LOG, ['전표번호', '전표 날짜', '거래처', '구역', '품목', '전표 품목명', '수량', '단위', '금액', '환산 수량', '환산 단위', '환산 단위당 단가']);
    const ptab = ss.getSheetByName(PRICE_TAB);
    const prows = ptab ? priceRows(ptab) : [];

    (body.lines || []).forEach(function (l) {
      if (!l.ledger) { result.skipped.push(l.receiptName + ' (장부 품목을 고르지 않음)'); return; }
      const key = String(l.ledger).split('|');
      const sec = key[0].trim();
      const name = key.slice(1).join('|').trim();
      let hit = rows.filter(function (r) { return r.section === sec && r.name === name; })[0];
      if (!hit) {
        const same = rows.filter(function (r) { return norm(r.name) === norm(name); });
        if (same.length === 1) hit = same[0];
      }
      if (!hit) { result.skipped.push(l.receiptName + ' → ' + name + ' (장부에서 줄을 찾지 못함)'); return; }
      const cell = sh.getRange(hit.row, col);
      if (cell.getFormula()) { result.skipped.push(l.receiptName + ' → ' + name + ' (수식 칸이라 건드리지 않음)'); return; }
      const amount = Number(l.amount) || 0;
      cell.setValue((Number(cell.getValue()) || 0) + amount);
      log.appendRow([body.id, sh.getName(), cell.getA1Notation(), amount, text(name), new Date()]);
      result.written.push(name);

      // 평균단가
      const p = findPriceRow(prows, hit.section, hit.name, l.receiptName);
      if (!p) { result.noPrice.push(name + ' (평균단가 탭에 없음)'); return; }
      if (p.error) { result.noPrice.push(name + ' (' + p.error + ')'); return; }
      const conv = baseQty(l.quantity, l.unit, p.def);
      if (!conv) result.noPrice.push(name + ' (' + l.quantity + (l.unit || '') + ' 를 기준 단위로 바꾸지 못함)');
      plog.appendRow([body.id, body.date, text(body.vendor), text(hit.section), text(p.name), text(l.receiptName), Number(l.quantity) || '', text(l.unit), amount,
        conv ? round(conv.qty, 4) : '', conv ? conv.unit : '', conv ? Math.round(amount / conv.qty) : '']);
      setPriceFormulas(ptab, p, hit.section, p.name);
      setTotalFormulas(ptab, prows, p);
    });
    return result;
  } finally {
    lock.releaseLock();
  }
}

// 예전에 이 전표로 더한 금액을 빼고, 단가 기록 줄도 지움
function undoReceipt(ss, id) {
  const log = ss.getSheetByName(LEDGER_LOG);
  if (log && log.getLastRow() > 1) {
    const v = log.getRange(2, 1, log.getLastRow() - 1, 4).getValues();
    for (let i = v.length - 1; i >= 0; i--) {
      if (String(v[i][0]) !== String(id)) continue;
      const sh = ss.getSheetByName(v[i][1]);
      if (sh) {
        const cell = sh.getRange(v[i][2]);
        if (!cell.getFormula()) {
          const next = (Number(cell.getValue()) || 0) - Number(v[i][3]);
          cell.setValue(Math.abs(next) < 0.5 ? '' : next);
        }
      }
      log.deleteRow(i + 2);
    }
  }
  const plog = ss.getSheetByName(PRICE_LOG);
  if (plog) removeRows(plog, id);
}

// "26년10월" 같은 탭. 없으면 "XX년X월"을 복사해 만들고 B2(년도)·C2(월)를 바꿈
function monthTab(ss, y, m) {
  const name = String(y).slice(2) + '년' + m + '월';
  let sh = ss.getSheetByName(name);
  if (sh) return { sh: sh, created: false };
  const tpl = ss.getSheetByName(MONTH_TEMPLATE);
  if (!tpl) return { error: '"' + name + '" 탭도, 복사할 "' + MONTH_TEMPLATE + '" 탭도 없습니다.' };
  sh = tpl.copyTo(ss).setName(name);
  sh.getRange('B2').setValue(y);
  sh.getRange('C2').setValue(m);
  SpreadsheetApp.flush();
  return { sh: sh, created: true };
}

// "2-1-4. 프레시원 소계" 같은 제목 줄 → 구역 이름 "프레시원". "부가세 제외/포함" 줄은 구역이 아님.
function sectionTitle(a) {
  const m = String(a).match(/^\\d+(-\\d+)*\\.\\s*(.*)$/);
  if (!m) return null;
  const s = m[2].replace(/\\s*(소계|합계)\\s*$/, '').trim();
  return s.indexOf('제외') !== -1 || s.indexOf('포함') !== -1 ? '' : s;
}

// 장부 탭의 품목 줄 (6번째 줄부터, 제목 줄 제외)
function ledgerRows(sh) {
  const vals = sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues();
  const rows = [];
  let sec = '';
  for (let i = 5; i < vals.length; i++) {
    const a = String(vals[i][0]).trim();
    if (!a) continue;
    const title = sectionTitle(a);
    if (title !== null) { if (title) sec = title; continue; }
    rows.push({ row: i + 1, section: sec, name: a });
  }
  return rows;
}

// 앱의 장부 품목 목록을 새로 고칠 때: 가장 최근 "YY년M월" 탭(없으면 XX년X월)의 품목 줄
function readLedgerItems(body) {
  let ss;
  try {
    ss = SpreadsheetApp.openById(body.ledgerId);
  } catch (err) {
    return { ok: false, error: '"매장 매출 매입 장부" 파일을 열지 못했습니다.' };
  }
  let best = null, bestKey = -1;
  ss.getSheets().forEach(function (s) {
    const m = s.getName().match(/^(\\d\\d)년(\\d{1,2})월$/);
    if (m && Number(m[1]) * 100 + Number(m[2]) > bestKey) { bestKey = Number(m[1]) * 100 + Number(m[2]); best = s; }
  });
  const sh = best || ss.getSheetByName(MONTH_TEMPLATE);
  if (!sh) return { ok: false, error: '장부에서 월 탭을 찾지 못했습니다.' };
  return { ok: true, tab: sh.getName(), items: ledgerRows(sh).map(function (r) { return { section: r.section, name: r.name }; }) };
}

// 평균단가 탭의 품목 줄과 단위 정의 (D: 1개당 무게 g, E·F: 박스 등, G·H: 안에 든 개수·단위, I·J: 최소 단위)
function priceRows(ptab) {
  const v = ptab.getRange(1, 1, ptab.getLastRow(), 10).getValues();
  const rows = [];
  let sec = '';
  for (let i = 5; i < v.length; i++) {
    const a = String(v[i][0]).trim();
    if (!a) continue;
    const title = sectionTitle(a);
    if (title !== null) { if (title) sec = title; continue; }
    rows.push({ row: i + 1, section: sec, name: a, def: { D: v[i][3], E: v[i][4], F: v[i][5], G: v[i][6], H: v[i][7], I: v[i][8], J: v[i][9] } });
  }
  return rows;
}

// 이름이 같은 줄. 같은 이름이 여러 구역에 있으면 구역 이름 첫 단어가 같은 쪽 (예: 네이버 식재료 ↔ 네이버 공산품)
function findPriceRow(prows, section, name, receiptName) {
  const same = prows.filter(function (p) { return norm(p.name) === norm(name); });
  if (same.length === 1) return same[0];
  if (same.length > 1) {
    const first = norm(String(section).split(' ')[0]);
    return same.filter(function (p) { return norm(p.section).indexOf(first) === 0; })[0] || null;
  }
  // 크기별로 나눈 줄 (예: 감자 10kg · 감자 20kg): 전표 품목명에 적힌 크기로 고름
  const sizes = prows.filter(function (p) { return norm(p.name).indexOf(norm(name)) === 0 && packSize(p.name) !== null; });
  if (!sizes.length) return null;
  const want = packSize(receiptName);
  const hit = sizes.filter(function (p) { return want !== null && Math.abs(packSize(p.name) - want) < 1e-9; })[0];
  if (hit) return hit;
  return { error: sizes.map(function (p) { return p.name; }).join(' / ') + ' 중 어느 것인지 몰라서 (전표 품목명에 크기를 적어 주세요. 예: ' + sizes[0].name + ')' };
}

// "감자 20kg 왕특" → 20 (kg). 500g → 0.5, 1.8L → 1.8. 크기가 없으면 null
function packSize(s) {
  const m = String(s || '').match(/(\\d+(?:\\.\\d+)?)\\s*(kg|g|ml|l)(?![a-z])/i);
  if (!m) return null;
  const k = unitKey(m[2]);
  return Number(m[1]) * (k === 'g' || k === 'ml' ? 0.001 : 1);
}

// "감자 (종합)" 줄: 크기별 줄(감자 10kg · 감자 20kg)의 kg 단가를 평균
function setTotalFormulas(ptab, prows, p) {
  const base = String(p.name).replace(/\\s*\\d+(?:\\.\\d+)?\\s*(kg|g|ml|l)(?![a-z]).*$/i, '');
  const total = prows.filter(function (r) { return norm(r.name) === norm(base) + '종합'; })[0];
  if (!total) return;
  const parts = prows.filter(function (r) { return norm(r.name).indexOf(norm(base)) === 0 && packSize(r.name) !== null; });
  const b = ptab.getRange(total.row, 2), c = ptab.getRange(total.row, 3);
  const cf = '=IFERROR(AVERAGE(' + parts.map(function (r) { return 'C' + r.row; }).join(',') + '),"")';
  if (c.getFormula() || c.getValue() === '') c.setFormula(cf);
  const size = minUnitSize(total.def);
  const bf = '=IFERROR(ROUND(C' + total.row + (size && size !== 1 ? '*' + size : '') + '),"")';
  if (b.getFormula() || b.getValue() === '') b.setFormula(bf);
}

// B(평균 단가) = 최소 단위(I·J)당, C(kg 단가) = 기준 단위(kg · L · 개 …)당. 칸에 직접 적은 값이 있으면 건드리지 않음.
function setPriceFormulas(ptab, p, section, name) {
  const b = ptab.getRange(p.row, 2), c = ptab.getRange(p.row, 3);
  const q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
  const crit = "'" + PRICE_LOG + "'!$D:$D," + q(section) + ",'" + PRICE_LOG + "'!$E:$E," + q(name) + ",'" + PRICE_LOG + "'!$J:$J,\\">0\\"";
  const cf = '=IFERROR(SUMIFS(\\'' + PRICE_LOG + '\\'!$I:$I,' + crit + ')/SUMIFS(\\'' + PRICE_LOG + '\\'!$J:$J,' + crit + '),"")';
  if (c.getFormula() || c.getValue() === '') c.setFormula(cf);
  const size = minUnitSize(p.def);
  const bf = '=IFERROR(ROUND(C' + p.row + (size && size !== 1 ? '*' + size : '') + '),"")';
  if (b.getFormula() || b.getValue() === '') b.setFormula(bf);
}

function unitKey(u) {
  const s = norm(u).replace(/\\./g, '');
  if (['kg', '킬로', '키로', '킬로그램'].indexOf(s) !== -1) return 'kg';
  if (['g', 'gr', '그램'].indexOf(s) !== -1) return 'g';
  if (['l', 'ℓ', '리터'].indexOf(s) !== -1) return 'l';
  if (['ml', '㎖', '미리'].indexOf(s) !== -1) return 'ml';
  if (['box', 'bx', 'ct', 'c/t', '박스', '상자'].indexOf(s) !== -1) return '박스';
  if (['ea', 'pc', 'pcs', '개'].indexOf(s) !== -1) return '개';
  return s;
}

function measure(k) {
  if (k === 'kg') return { dim: 'w', f: 1 };
  if (k === 'g') return { dim: 'w', f: 0.001 };
  if (k === 'l') return { dim: 'v', f: 1 };
  if (k === 'ml') return { dim: 'v', f: 0.001 };
  return null;
}

// 최소 단위(I·J)가 기준 단위로 몇인지 (예: 420g → 0.42 kg)
function minUnitSize(def) {
  const I = Number(def.I) || 0;
  if (!I) return 1;
  const J = unitKey(def.J), m = measure(J);
  return m ? round(I * m.f, 6) : I;
}

// 전표의 수량·단위 → 기준 단위(kg · L, 무게·부피가 아닌 품목은 J 단위) 수량
function baseQty(qty, unit, def) {
  const q = Number(qty);
  if (!(q > 0)) return null;
  const J = unitKey(def.J), Jm = measure(J);
  const base = Jm ? (Jm.dim === 'w' ? 'kg' : 'L') : String(def.J || '').trim();
  if (!base) return null;
  const toBase = function (n, k) {
    const m = measure(k);
    if (Jm && m && m.dim === Jm.dim) return n * m.f;
    if (!Jm && k === J) return n;
    return null;
  };
  const I = Number(def.I) || 0;
  const F = unitKey(def.F), H = unitKey(def.H), G = Number(def.G) || 0;
  let k = unitKey(unit);
  if (!k) k = F || H || J;

  // 1) 무게·부피(또는 최소 단위와 같은 단위)로 적힌 경우
  const direct = toBase(q, k);
  if (direct !== null) return { qty: direct, unit: base };
  // H 단위(개·팩·봉지 …) 1개의 크기. "개"이고 D(1개당 무게 g)가 있으면 그 값을 씀
  const sizeH = function () {
    if (H === '개' && Number(def.D) > 0 && Jm && Jm.dim === 'w') return Number(def.D) / 1000;
    return I ? toBase(I, J) : null;
  };
  // 2) 전표 단위가 H (개·팩·봉지 …)
  if (H && k === H) {
    const s = sizeH();
    return s ? { qty: q * s, unit: base } : null;
  }
  // 3) 전표 단위가 F (박스·포 …)
  if (F && k === F) {
    if (G && H) {
      const inBox = toBase(G, H);
      if (inBox !== null) return { qty: q * inBox, unit: base };
      const s = sizeH();
      return s ? { qty: q * G * s, unit: base } : null;
    }
    const s = I ? toBase(I, J) : null;
    return s ? { qty: q * s, unit: base } : null;
  }
  // 4) 박스·개 정의가 없는 품목: 전표 단위 1개 = 최소 단위(I·J)
  if (!F && !H && I) {
    const s = toBase(I, J);
    return s ? { qty: q * s, unit: base } : null;
  }
  return null;
}

function norm(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[\\s()]/g, '').toLowerCase();
}

function round(n, d) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

// ---------- 인건비 탭에 출퇴근 기록 넣기 ----------
// "N월 인건비" 탭의 날짜 칸(1일~말일)만 채움. 수식 칸은 건드리지 않음.
function writeLabor(ss, body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let sh = ss.getSheetByName(body.tabName);
    let created = false;
    if (!sh) {
      const tpl = ss.getSheetByName(body.templateName);
      if (!tpl) return { ok: false, error: '"' + body.tabName + '" 탭도, 복사할 "' + body.templateName + '" 탭도 없습니다.' };
      sh = tpl.copyTo(ss).setName(body.tabName);
      sh.getRange('B2').setValue(body.year);
      sh.getRange('C2').setValue(body.month);
      SpreadsheetApp.flush();
      created = true;
    }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    const names = sh.getRange(1, 1, lastRow, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
    const headers = [];
    names.forEach(function (v, i) { if (v === '직원') headers.push(i + 1); });
    if (headers.length < 2) return { ok: false, error: '"' + body.tabName + '" 탭에서 "직원" 제목 줄(정직원 · 아르바이트)을 찾지 못했습니다.' };

    const sections = { monthly: headers[0], hourly: headers[1] };
    const result = { ok: true, sheetName: ss.getName(), url: ss.getUrl(), tab: body.tabName, created: created, written: [], added: [], unmatched: [] };

    (body.staff || []).forEach(function (st) {
      const headerRow = sections[st.section];
      // 그 구역의 직원 줄: 제목 바로 아래부터 "만근일수/근무시간"(H열) 칸이 이어지는 곳까지
      const hCol = sh.getRange(headerRow + 1, 8, 20, 1).getFormulas();
      let count = 0;
      while (count < hCol.length && hCol[count][0] !== '') count++;
      if (count === 0) { result.unmatched.push(st.name); return; }

      // 날짜 칸 위치: 제목 줄의 날짜(1일, 2일 …)
      const head = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0];
      const dayCol = {};
      head.forEach(function (v, i) {
        if (v instanceof Date && v.getMonth() + 1 === Number(body.month)) dayCol[v.getDate()] = i + 1;
      });
      if (!dayCol[body.fromDay] || !dayCol[body.toDay]) { result.unmatched.push(st.name + ' (날짜 칸을 찾지 못함)'); return; }

      let row = -1;
      for (let i = 0; i < count; i++) {
        if (names[headerRow + i] === st.name) { row = headerRow + 1 + i; break; }
      }
      if (row === -1) {
        for (let i = 0; i < count; i++) {
          if (names[headerRow + i] === '') {
            row = headerRow + 1 + i;
            sh.getRange(row, 1).setValue(st.name);
            names[headerRow + i] = st.name;
            result.added.push(st.name);
            break;
          }
        }
      }
      if (row === -1) { result.unmatched.push(st.name + ' (빈 줄 없음)'); return; }

      const from = dayCol[body.fromDay];
      const values = [];
      for (let d = body.fromDay; d <= body.toDay; d++) {
        const v = st.days[String(d)];
        values.push(v === undefined || v === null ? '' : v);
      }
      sh.getRange(row, from, 1, values.length).setValues([values]);
      result.written.push(st.name);
    });
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ---------- 인건비 탭의 일용직 구역 ----------
// "성함" 제목 줄 아래, "총 근로 시간"(H열) 수식이 이어지는 줄들. 탭이 없으면 "X월 인건비"를 복사해 만듦.
function openDayLaborSection(ss, body) {
  let sh = ss.getSheetByName(body.tabName);
  let created = false;
  if (!sh) {
    const tpl = ss.getSheetByName(body.templateName);
    if (!tpl) return { error: '"' + body.tabName + '" 탭도, 복사할 "' + body.templateName + '" 탭도 없습니다.' };
    sh = tpl.copyTo(ss).setName(body.tabName);
    sh.getRange('B2').setValue(body.year);
    sh.getRange('C2').setValue(body.month);
    SpreadsheetApp.flush();
    created = true;
  }
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const names = sh.getRange(1, 1, lastRow, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
  const headerRow = names.indexOf('성함') + 1;
  if (headerRow === 0) return { error: '"' + body.tabName + '" 탭에서 일용직 구역("성함" 제목 줄)을 찾지 못했습니다.' };
  const head = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const hCol = sh.getRange(headerRow + 1, 8, Math.max(1, lastRow - headerRow), 1).getFormulas();
  let count = 0;
  while (count < hCol.length && hCol[count][0] !== '') count++;
  return { sh: sh, created: created, names: names, headerRow: headerRow, head: head, count: count };
}

// 이름이 같은 줄 번호 (없으면 빈 줄에 이름을 적고 그 줄). 빈 줄도 없으면 -1
function dayLaborRow(sec, name, added) {
  for (let i = 0; i < sec.count; i++) if (sec.names[sec.headerRow + i] === name) return sec.headerRow + 1 + i;
  for (let i = 0; i < sec.count; i++) {
    if (sec.names[sec.headerRow + i] === '') {
      sec.sh.getRange(sec.headerRow + 1 + i, 1).setValue(name);
      sec.names[sec.headerRow + i] = name;
      added.push(name);
      return sec.headerRow + 1 + i;
    }
  }
  return -1;
}

// 날짜 칸에 근무시간 (메모는 앱이 보낸 값, 지금은 빈 값 → 셀 메모 없음). 수식 칸과 주민번호 칸은 건드리지 않음.
function writeDayLabor(ss, body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sec = openDayLaborSection(ss, body);
    if (sec.error) return { ok: false, error: sec.error };
    const dayCol = {};
    sec.head.forEach(function (v, i) {
      if (v instanceof Date && v.getMonth() + 1 === Number(body.month)) dayCol[v.getDate()] = i + 1;
    });
    const result = { ok: true, sheetName: ss.getName(), tab: body.tabName, created: sec.created, written: [], added: [], unmatched: [] };
    (body.workers || []).forEach(function (w) {
      const row = dayLaborRow(sec, w.name, result.added);
      if (row === -1) { result.unmatched.push(w.name + ' (빈 줄 없음)'); return; }
      Object.keys(w.days).forEach(function (d) {
        const col = dayCol[Number(d)];
        if (!col) return;
        const cell = sec.sh.getRange(row, col);
        const v = w.days[d];
        if (v === null) { cell.setValue(''); cell.setNote(''); return; }
        cell.setValue(v.hours);
        cell.setNote(v.note || '');
      });
      result.written.push(w.name);
    });
    return result;
  } finally {
    lock.releaseLock();
  }
}

// 주민번호를 그 사람 줄의 주민번호 칸에 글자 그대로 적음 (앱에는 저장하지 않음)
function writeDayLaborRrn(ss, body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sec = openDayLaborSection(ss, body);
    if (sec.error) return { ok: false, error: sec.error };
    let col = 2;
    sec.head.forEach(function (v, i) { if (String(v).replace(/\\s/g, '').indexOf('주민') !== -1) col = i + 1; });
    const added = [];
    const row = dayLaborRow(sec, body.name, added);
    if (row === -1) return { ok: false, error: '일용직 구역에 빈 줄이 없어 ' + body.name + ' 님을 넣지 못했습니다.' };
    const cell = sec.sh.getRange(row, col);
    cell.setNumberFormat('@');
    cell.setValue(body.rrn);
    return { ok: true, tab: body.tabName, created: sec.created, added: added };
  } finally {
    lock.releaseLock();
  }
}

function getSheet(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sh;
}

function removeRows(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) sh.deleteRow(i + 2);
  }
}

// 글자가 = + - @ 로 시작하면 수식으로 바뀌지 않게
function text(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\\-@]/.test(s) ? "'" + s : s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`
}
