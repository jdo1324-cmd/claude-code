import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConfirmButton as SubmitWithConfirm } from '@/app/components/confirm-button'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import type { Profile } from '@/lib/auth'
import { formatTime } from '@/lib/format'
import { RECEIPT_BUCKET } from '@/lib/receipt-ai'
import { ledgerHistory } from '@/lib/receipt-learning'
import { RECEIPT_STATUS_LABEL, priceChange, won, type PriceRow, type Receipt } from '@/lib/receipts'
import { createClient } from '@/lib/supabase/server'
import { ConfirmForm, type LedgerItem } from './confirm-form'
import { closeReceipt, retryReceipt, sendToSheet } from './receipt-actions'

// 전표 1건 화면. 올린 사람(/receipts/…)과 사장·관리자(/admin/receipts/…)가 같이 씀.
// 확정·다시 읽기·반려는 둘 다, 무효·장부로 다시 보내기는 사장·관리자만.
export async function ReceiptDetail({
  id,
  admin,
  back,
  error,
  ok,
}: {
  id: number
  admin: boolean
  back: '/admin/receipts' | '/receipts'
  error?: string
  ok?: string
}) {
  const supabase = await createClient()
  const { data } = await supabase.from('receipts').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const receipt = data as Receipt

  const [
    { data: urlData },
    { data: profileData },
    { data: priceData },
    { data: itemData },
    { data: exportData },
    { data: ledgerData },
  ] = await Promise.all([
    supabase.storage.from(RECEIPT_BUCKET).createSignedUrls(receipt.photo_paths, 60 * 60),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('receipt_price_history').select('*').eq('receipt_id', id).order('id'),
    supabase.from('receipt_items').select('id, ledger_item').eq('receipt_id', id),
    supabase
      .from('receipt_sheet_exports')
      .select('sent_at, sent_by')
      .eq('receipt_id', id)
      .order('sent_at', { ascending: false })
      .limit(1),
    supabase.from('ledger_items').select('section, name').order('sort_order'),
  ])
  const lastExport = (exportData ?? [])[0] as { sent_at: string; sent_by: string } | undefined
  const names = Object.fromEntries(
    ((profileData ?? []) as Pick<Profile, 'id' | 'full_name'>[]).map((p) => [p.id, p.full_name]),
  )
  const prices = (priceData ?? []) as PriceRow[]
  const ledgerOf = Object.fromEntries(
    ((itemData ?? []) as { id: number; ledger_item: string | null }[]).map((it) => [it.id, it.ledger_item]),
  )
  const open = ['proposed', 'failed'].includes(receipt.status)

  return (
    <main>
      {receipt.status === 'processing' && <RealtimeRefresh table="receipts" filter={`id=eq.${id}`} />}
      <p>
        <Link href={back}>◀ 전표 목록</Link>
      </p>
      <h1>
        전표 #{id} — {RECEIPT_STATUS_LABEL[receipt.status]}
      </h1>
      <p>
        {names[receipt.created_by] ?? '?'} · {receipt.created_at.slice(0, 10)} {formatTime(receipt.created_at)} 올림
        {receipt.note && ` · 메모: ${receipt.note}`}
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* 왼쪽: 사진 (눌러서 크게 보기) */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2>사진 ({receipt.photo_paths.length}장)</h2>
          {(urlData ?? []).map((u, i) =>
            u.signedUrl ? (
              <a key={i} href={u.signedUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u.signedUrl}
                  alt={`전표 ${i + 1}장`}
                  style={{ width: '100%', maxWidth: 520, border: '1px solid var(--border)', marginBottom: 8 }}
                />
              </a>
            ) : null,
          )}
        </div>

        {/* 오른쪽: AI 제안 / 확정 값 */}
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          {receipt.status === 'processing' && <p>🤖 AI가 전표를 읽는 중입니다. 끝나면 이 화면이 자동으로 바뀝니다.</p>}

          {open && (
            <>
              <h2>AI가 읽은 내용 확인 후 확정</h2>
              <p className="alert alert-info">
                아래 값은 AI가 읽은 <strong>제안</strong>입니다. 사진과 하나씩 대조하고, 틀린 곳을 고친 뒤 확정하세요.
                확정하면 매출 매입 장부에 바로 적힙니다.
              </p>
              {receipt.ai_error && <p className="alert alert-error">AI: {receipt.ai_error}</p>}
              {receipt.proposal?.notes && <p style={{ color: 'var(--warn)' }}>AI 메모: {receipt.proposal.notes}</p>}
              <ConfirmForm
                id={id}
                proposal={receipt.proposal}
                ledgerItems={(ledgerData ?? []) as LedgerItem[]}
                ledgerHistory={open ? await ledgerHistory() : {}}
                back={back}
              />
              <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                <form action={retryReceipt}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit">🤖 AI로 다시 읽기</button>
                </form>
                <form action={closeReceipt}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="status" value="rejected" />
                  <input name="reason" required placeholder="반려 사유 (예: 사진 흐림, 중복)" size={20} />{' '}
                  <SubmitWithConfirm message="이 전표를 반려할까요?">반려</SubmitWithConfirm>
                </form>
              </div>
            </>
          )}

          {(receipt.status === 'confirmed' || receipt.status === 'void') && (
            <>
              <h2>확정된 기록</h2>
              {receipt.status === 'void' && (
                <p className="alert alert-error">
                  무효: {receipt.close_reason} ({names[receipt.closed_by ?? ''] ?? '?'}) — 단가 비교에서 빠집니다.
                </p>
              )}
              <p>
                {receipt.vendor} · {receipt.receipt_date} · 합계 {won(receipt.total_amount)} —{' '}
                {names[receipt.confirmed_by ?? ''] ?? '?'} 확정
              </p>
              {receipt.status === 'confirmed' && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>품목</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>금액</th>
                        <th>장부 품목</th>
                        <th>지난번 대비 단가</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prices.map((p) => {
                        const change = priceChange(p)
                        const ledger = ledgerOf[p.id]
                        return (
                          <tr key={p.id}>
                            <td>{p.item_name}</td>
                            <td>
                              {Number(p.quantity)}
                              {p.unit}
                            </td>
                            <td className="num">{won(p.unit_price)}</td>
                            <td className="num">{won(p.line_total)}</td>
                            <td className="small">{ledger ? ledger.replace('|', ' · ') : '안 적음'}</td>
                            <td
                              style={{
                                color:
                                  change?.direction === 'up'
                                    ? 'var(--danger)'
                                    : change?.direction === 'down'
                                      ? 'var(--info)'
                                      : 'var(--faint)',
                              }}
                            >
                              {change ? `${change.text} (지난번 ${p.prev_receipt_date} ${p.prev_vendor})` : '첫 기록'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {receipt.status === 'confirmed' && (
                <div className="card" style={{ margin: '12px 0' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <strong>매출 매입 장부</strong>{' '}
                      {lastExport ? (
                        <span className="badge badge-ok">
                          적음 · {lastExport.sent_at.slice(0, 10)} {formatTime(lastExport.sent_at)} ·{' '}
                          {names[lastExport.sent_by] ?? '?'}
                        </span>
                      ) : (
                        <span className="badge">아직 안 적음</span>
                      )}
                    </div>
                    {admin && (
                      <form action={sendToSheet}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="back" value={back} />
                        <SubmitWithConfirm
                          message={
                            lastExport
                              ? '이미 장부에 적은 전표입니다. 예전에 더한 금액을 빼고 다시 적을까요?'
                              : '이 전표를 매출 매입 장부에 적을까요?'
                          }
                        >
                          {lastExport ? '장부에 다시 적기' : '📤 장부에 적기'}
                        </SubmitWithConfirm>
                      </form>
                    )}
                  </div>
                </div>
              )}
              {admin && receipt.status === 'confirmed' && (
                <form action={closeReceipt} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="status" value="void" />
                  잘못 확정했다면: <input name="reason" required placeholder="무효 사유" size={16} />{' '}
                  <SubmitWithConfirm message="이 전표를 무효 처리할까요? (장부에 더한 금액도 뺍니다)">
                    무효 처리
                  </SubmitWithConfirm>
                </form>
              )}
              {!admin && receipt.status === 'confirmed' && (
                <p className="small muted">잘못 확정했다면 사장님·관리자에게 무효 처리를 부탁하세요.</p>
              )}
            </>
          )}

          {receipt.status === 'rejected' && (
            <p className="alert alert-error">
              반려: {receipt.close_reason} ({names[receipt.closed_by ?? ''] ?? '?'})
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
