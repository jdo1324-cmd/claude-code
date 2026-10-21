import 'server-only'
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
