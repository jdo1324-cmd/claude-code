import 'server-only'
import { ATTENDANCE_SELECT, monthRange, netMinutes, type AttendanceRecord } from '@/lib/attendance'
import { RECEIPT_BUCKET } from '@/lib/receipt-ai'
import { createAdminClient } from '@/lib/supabase/admin'

// 전표를 사장님의 구글 시트로 보냄.
// 사장님 시트에 붙여 넣은 Apps Script(웹 앱)가 받아서 "전표" · "품목" 탭에 줄을 쓰고,
// 사진은 사장님 구글 드라이브의 "매장관리 전표 사진" 폴더에 저장함.

export type SheetSettings = { webhook_url: string | null; secret: string }

// Apps Script 웹 앱 주소만 허용 (다른 곳으로 전표가 새지 않게)
const WEBHOOK_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/

export function isValidWebhookUrl(url: string) {
  return WEBHOOK_PATTERN.test(url)
}

export async function getSheetSettings(): Promise<SheetSettings> {
  const { data, error } = await createAdminClient()
    .from('google_sheet_settings')
    .select('webhook_url, secret')
    .eq('id', 1)
    .single()
  if (error || !data) throw new Error('구글 시트 설정을 불러오지 못했습니다')
  return data as SheetSettings
}

type ScriptReply = { ok: boolean; error?: string; sheetName?: string; url?: string }

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

export async function testConnection() {
  return callScript(await getSheetSettings(), { type: 'ping' })
}

type ItemRow = {
  line_no: number
  item_name: string
  quantity: number
  unit: string | null
  unit_price: number
  line_total: number
}

// 확정된 전표 1건을 시트로 보냄
export async function sendReceiptToSheet(receiptId: number, sentBy: string): Promise<ScriptReply> {
  const admin = createAdminClient()
  const settings = await getSheetSettings()

  const { data: receipt } = await admin.from('receipts').select('*').eq('id', receiptId).maybeSingle()
  if (!receipt) return { ok: false, error: '전표를 찾을 수 없습니다.' }
  if (receipt.status !== 'confirmed') return { ok: false, error: '확정된 전표만 시트로 보낼 수 있습니다.' }

  const [{ data: itemData }, { data: profileData }] = await Promise.all([
    admin
      .from('receipt_items')
      .select('line_no, item_name, quantity, unit, unit_price, line_total')
      .eq('receipt_id', receiptId)
      .order('line_no'),
    admin.from('profiles').select('id, full_name'),
  ])
  const nameOf = (id: string | null) => (profileData ?? []).find((p) => p.id === id)?.full_name ?? ''
  const items = (itemData ?? []) as ItemRow[]

  // 사진 원본을 함께 보냄 (구글 드라이브에 저장됨)
  const photos: { name: string; type: string; data: string }[] = []
  for (const [i, path] of (receipt.photo_paths as string[]).entries()) {
    const { data: blob } = await admin.storage.from(RECEIPT_BUCKET).download(path)
    if (!blob) continue
    const ext = path.split('.').pop() ?? 'jpg'
    photos.push({
      name: `전표${receiptId}-${i + 1}.${ext}`,
      type: blob.type || 'image/jpeg',
      data: Buffer.from(await blob.arrayBuffer()).toString('base64'),
    })
  }

  const reply = await callScript(settings, {
    type: 'receipt',
    receipt: {
      id: receiptId,
      date: receipt.receipt_date,
      vendor: receipt.vendor,
      total: receipt.total_amount === null ? null : Number(receipt.total_amount),
      uploadedBy: nameOf(receipt.created_by),
      uploadedAt: receipt.created_at,
      confirmedBy: nameOf(receipt.confirmed_by),
      confirmedAt: receipt.confirmed_at,
      note: receipt.note,
      items: items.map((it) => ({
        no: it.line_no,
        name: it.item_name,
        quantity: Number(it.quantity),
        unit: it.unit,
        unitPrice: Number(it.unit_price),
        lineTotal: Number(it.line_total),
      })),
    },
    photos,
  })

  if (reply.ok) {
    await admin.from('receipt_sheet_exports').insert({ receipt_id: receiptId, sent_by: sentBy })
  }
  return reply
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
// 날짜 칸에 근무시간, 칸 메모에 일급·추가근무 수당. 앱에서 지운 기록의 칸은 비움.
export async function sendDayLaborToSheet(month: string, sentBy: string) {
  const admin = createAdminClient()
  const { start, end } = monthRange(month)
  const { data } = await admin
    .from('day_labor_entries')
    .select('work_date, worker_name, hours, daily_wage, extra_pay, note, status')
    .gte('work_date', start)
    .lte('work_date', end)
  const rows = (data ?? []) as {
    work_date: string
    worker_name: string
    hours: number
    daily_wage: number
    extra_pay: number
    note: string | null
    status: 'valid' | 'void'
  }[]
  if (rows.length === 0) return { ok: false, error: '이 달에는 일용직 기록이 없습니다.' } as LaborReply

  const workers = new Map<string, Record<string, { hours: number; note: string } | null>>()
  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
  for (const r of rows) {
    const name = r.worker_name.trim()
    const day = String(Number(r.work_date.slice(8)))
    const days = workers.get(name) ?? {}
    workers.set(name, days)
    if (r.status === 'void') {
      if (!(day in days)) days[day] = null // 지운 기록 → 그 칸 비움 (같은 날 유효한 기록이 있으면 아래에서 덮어씀)
      continue
    }
    const prev = days[day]
    const hours = Number(r.hours) + (prev ? prev.hours : 0)
    const parts = [`일급 ${won(r.daily_wage)}`, r.extra_pay ? `추가근무 수당 ${won(r.extra_pay)}` : null, r.note]
      .filter(Boolean)
      .join(' · ')
    days[day] = { hours, note: prev ? `${prev.note}\n${parts}` : parts }
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

// 사장님이 구글 시트에 붙여 넣을 Apps Script 코드 (비밀값이 들어 있음)
export function appsScriptSource(secret: string) {
  return `// 매장 운영 관리 앱 → 이 시트로 전표 받기
// 이 코드는 그대로 붙여 넣으세요. 아래 비밀값은 바꾸지 마세요.
const SECRET = '${secret}';
const PHOTO_FOLDER = '매장관리 전표 사진';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return reply({ ok: false, error: '비밀값이 맞지 않습니다. 앱의 [구글 시트 연결] 화면에서 코드를 다시 복사해 붙여 넣으세요.' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (body.type === 'ping') return reply({ ok: true, sheetName: ss.getName(), url: ss.getUrl() });
  if (body.type === 'labor') return reply(writeLabor(ss, body));
  if (body.type === 'day_labor') return reply(writeDayLabor(ss, body));
  if (body.type !== 'receipt') return reply({ ok: false, error: '알 수 없는 요청' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const r = body.receipt;
    const receipts = getSheet(ss, '전표', ['전표번호', '전표 날짜', '거래처', '합계', '품목 수', '사진', '올린 사람', '올린 시각', '확정한 사람', '확정 시각', '메모', '보낸 시각']);
    const items = getSheet(ss, '품목', ['전표번호', '전표 날짜', '거래처', '줄', '품목', '수량', '단위', '단가', '금액']);

    // 같은 전표를 다시 보내면 예전 줄과 사진을 지우고 새로 씀
    removeRows(receipts, r.id);
    removeRows(items, r.id);
    const folder = getFolder();
    const old = folder.searchFiles("title contains '전표" + r.id + "-'");
    while (old.hasNext()) {
      const f = old.next();
      if (f.getName().indexOf('전표' + r.id + '-') === 0) f.setTrashed(true);
    }

    const links = (body.photos || []).map(function (p) {
      const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.type, p.name);
      return folder.createFile(blob).getUrl();
    });

    receipts.appendRow([r.id, r.date, text(r.vendor), r.total, r.items.length, links.join('\\n'), text(r.uploadedBy), toDate(r.uploadedAt), text(r.confirmedBy), toDate(r.confirmedAt), text(r.note), new Date()]);
    r.items.forEach(function (it) {
      items.appendRow([r.id, r.date, text(r.vendor), it.no, text(it.name), it.quantity, text(it.unit), it.unitPrice, it.lineTotal]);
    });
    return reply({ ok: true, sheetName: ss.getName(), url: ss.getUrl() });
  } finally {
    lock.releaseLock();
  }
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

// ---------- 인건비 탭의 일용직 구역에 일용 근무 넣기 ----------
// "성함" 제목 줄 아래 구역에서 이름으로 줄을 찾아(없으면 빈 줄에 이름 추가) 날짜 칸에 근무시간을 넣음.
// 일급·추가근무 수당은 그 칸의 메모로 남김. 수식 칸과 주민번호 칸은 건드리지 않음.
function writeDayLabor(ss, body) {
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
    const headerRow = names.indexOf('성함') + 1;
    if (headerRow === 0) return { ok: false, error: '"' + body.tabName + '" 탭에서 일용직 구역("성함" 제목 줄)을 찾지 못했습니다.' };

    const head = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0];
    const dayCol = {};
    head.forEach(function (v, i) {
      if (v instanceof Date && v.getMonth() + 1 === Number(body.month)) dayCol[v.getDate()] = i + 1;
    });
    // 직원 줄: 제목 바로 아래부터 "총 근로 시간"(H열) 수식이 이어지는 곳까지
    const hCol = sh.getRange(headerRow + 1, 8, Math.max(1, lastRow - headerRow), 1).getFormulas();
    let count = 0;
    while (count < hCol.length && hCol[count][0] !== '') count++;

    const result = { ok: true, sheetName: ss.getName(), tab: body.tabName, created: created, written: [], added: [], unmatched: [] };
    (body.workers || []).forEach(function (w) {
      let row = -1;
      for (let i = 0; i < count; i++) if (names[headerRow + i] === w.name) { row = headerRow + 1 + i; break; }
      if (row === -1) {
        for (let i = 0; i < count; i++) {
          if (names[headerRow + i] === '') {
            row = headerRow + 1 + i;
            sh.getRange(row, 1).setValue(w.name);
            names[headerRow + i] = w.name;
            result.added.push(w.name);
            break;
          }
        }
      }
      if (row === -1) { result.unmatched.push(w.name + ' (빈 줄 없음)'); return; }
      Object.keys(w.days).forEach(function (d) {
        const col = dayCol[Number(d)];
        if (!col) return;
        const cell = sh.getRange(row, col);
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

function getFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) {}
  }
  const folder = DriveApp.createFolder(PHOTO_FOLDER);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// 글자가 = + - @ 로 시작하면 수식으로 바뀌지 않게
function text(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\\-@]/.test(s) ? "'" + s : s;
}

function toDate(v) {
  return v ? new Date(v) : '';
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`
}
