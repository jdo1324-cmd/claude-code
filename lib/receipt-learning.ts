import 'server-only'
import type { ReceiptProposal } from '@/lib/receipt-ai'
import { createAdminClient } from '@/lib/supabase/admin'

// 전표 "학습": AI 자체는 고친 내용을 기억하지 못하므로, 확정 기록과 고친 기록을 모아 두었다가
// 다음 AI 읽기 때 함께 알려 주고, 장부 품목 추천에도 씀.

// DB의 receipt_items.normalized_name 과 같은 규칙 (공백 없애고 소문자)
export const nameKey = (s: string) => s.replace(/\s+/g, '').toLowerCase()

type ConfirmedLine = {
  name: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  line_total: number | null
  tax?: number | null
  ai_line?: number | null
}

const same = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim()
const sameNum = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == b : Math.abs(Number(a) - Number(b)) < 0.001

// 확정할 때: AI가 읽은 줄과 확정한 줄을 비교해 다른 곳을 기록
export async function recordCorrections(receiptId: number, lines: ConfirmedLine[]) {
  const admin = createAdminClient()
  const { data } = await admin.from('receipts').select('proposal, vendor').eq('id', receiptId).single()
  const proposal = data?.proposal as ReceiptProposal | null
  if (!proposal) return
  const vendor = (data?.vendor as string | null) ?? proposal.vendor
  const rows: Record<string, unknown>[] = []
  const add = (field: string, ai: unknown, confirmed: unknown, itemName: string) =>
    rows.push({
      receipt_id: receiptId,
      vendor,
      field,
      ai_value: ai == null ? null : String(ai),
      confirmed_value: confirmed == null ? null : String(confirmed),
      item_name: itemName,
    })

  const used = new Set<number>()
  for (const line of lines) {
    const ai = line.ai_line == null ? undefined : proposal.items[line.ai_line]
    if (!ai) {
      add('added', null, line.name, line.name)
      continue
    }
    used.add(line.ai_line!)
    if (!same(ai.name, line.name)) add('name', ai.name, line.name, line.name)
    if (!same(ai.unit, line.unit)) add('unit', ai.unit, line.unit, line.name)
    if (!sameNum(ai.quantity, line.quantity)) add('quantity', ai.quantity, line.quantity, line.name)
    if (!sameNum(ai.unit_price, line.unit_price)) add('unit_price', ai.unit_price, line.unit_price, line.name)
    if (!sameNum(ai.line_total, line.line_total)) add('line_total', ai.line_total, line.line_total, line.name)
    if (!sameNum(ai.tax ?? null, line.tax ?? null)) add('tax', ai.tax, line.tax, line.name)
  }
  proposal.items.forEach((ai, i) => {
    if (!used.has(i)) add('removed', ai.name, null, ai.name)
  })
  if (rows.length) await admin.from('receipt_corrections').insert(rows)
}

// AI 읽기 전에: 지난 확정 품목(거래처별)과 품목명·단위를 고친 예를 글로 만들어 프롬프트에 붙임
export async function learningHints() {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: itemData }, { data: fixData }] = await Promise.all([
    admin
      .from('receipt_items')
      .select('item_name, unit, receipts!inner(vendor, status, confirmed_at)')
      .eq('receipts.status', 'confirmed')
      .gte('receipts.confirmed_at', since)
      .order('id', { ascending: false })
      .limit(600),
    admin
      .from('receipt_corrections')
      .select('field, ai_value, confirmed_value')
      .in('field', ['name', 'unit'])
      .gte('created_at', since)
      .order('id', { ascending: false })
      .limit(300),
  ])

  // 거래처별 품목명(단위), 중복 없이
  const byVendor = new Map<string, Set<string>>()
  for (const it of (itemData ?? []) as unknown as {
    item_name: string
    unit: string | null
    receipts: { vendor: string | null }
  }[]) {
    const vendor = it.receipts?.vendor?.trim() || '(거래처 모름)'
    const set = byVendor.get(vendor) ?? new Set<string>()
    byVendor.set(vendor, set)
    if (set.size < 60) set.add(it.unit ? `${it.item_name}(${it.unit})` : it.item_name)
  }

  // 같은 고침이 여러 번이면 한 번만 (많이 나온 순)
  const fixes = new Map<string, number>()
  for (const f of (fixData ?? []) as { field: string; ai_value: string | null; confirmed_value: string | null }[]) {
    if (!f.ai_value || !f.confirmed_value) continue
    const key = `${f.field === 'name' ? '품목명' : '단위'}: "${f.ai_value}" → "${f.confirmed_value}"`
    fixes.set(key, (fixes.get(key) ?? 0) + 1)
  }
  const topFixes = [...fixes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)

  if (byVendor.size === 0 && topFixes.length === 0) return ''
  const parts: string[] = []
  if (byVendor.size) {
    parts.push(
      '이 가게에서 예전에 확정한 품목명(단위)입니다. 사진 속 품목이 이 중 하나와 분명히 같은 물건이면 이 이름과 단위를 그대로 쓰세요. 다른 물건이면 사진에 적힌 대로 쓰세요.',
      ...[...byVendor].slice(0, 15).map(([v, names]) => `- ${v}: ${[...names].join(', ')}`),
    )
  }
  if (topFixes.length) {
    parts.push(
      '예전에 AI가 읽은 값을 사람이 이렇게 고쳤습니다. 같은 경우에는 고친 쪽으로 읽으세요.',
      ...topFixes.map(([k]) => `- ${k}`),
    )
  }
  return parts.join('\n')
}

// 장부 품목 추천: 예전에 같은 품목명으로 확정할 때 고른 장부 품목 (가장 최근 것).
// AI가 처음 읽은 이름으로도 찾을 수 있게, 고친 기록의 "AI 이름 → 확정 이름"도 이어 줌.
export async function ledgerHistory(): Promise<Record<string, string>> {
  const admin = createAdminClient()
  const [{ data: itemData }, { data: fixData }] = await Promise.all([
    admin
      .from('receipt_items')
      .select('normalized_name, ledger_item')
      .not('ledger_item', 'is', null)
      .order('id', { ascending: false })
      .limit(2000),
    admin
      .from('receipt_corrections')
      .select('ai_value, confirmed_value')
      .eq('field', 'name')
      .order('id', { ascending: false })
      .limit(1000),
  ])
  const map: Record<string, string> = {}
  for (const it of (itemData ?? []) as { normalized_name: string; ledger_item: string }[]) {
    if (!(it.normalized_name in map)) map[it.normalized_name] = it.ledger_item
  }
  for (const f of (fixData ?? []) as { ai_value: string | null; confirmed_value: string | null }[]) {
    if (!f.ai_value || !f.confirmed_value) continue
    const ledger = map[nameKey(f.confirmed_value)]
    if (ledger && !(nameKey(f.ai_value) in map)) map[nameKey(f.ai_value)] = ledger
  }
  return map
}
