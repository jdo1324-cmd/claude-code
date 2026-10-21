import Link from 'next/link'
import { ConfirmButton } from '@/app/components/confirm-button'
import { RealtimeRefresh } from '@/app/components/realtime-refresh'
import { getCurrentProfile, isAdmin } from '@/lib/auth'
import {
  PHASES,
  PHASE_LABEL,
  TYPE_LABEL,
  formatValue,
  groupByCategory,
  loadChecklist,
  progress,
  type ChecklistEntry,
  type ChecklistItem,
} from '@/lib/checklist'
import { formatTime, todayKST } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { completeItem, voidEntry } from './actions'
import { PhotoUpload } from './photo-upload'

const badge = (color: string) => ({
  display: 'inline-block',
  fontSize: 12,
  padding: '0 6px',
  marginLeft: 4,
  border: `1px solid ${color}`,
  color,
})

export default async function ChecklistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const me = await getCurrentProfile()
  const date = todayKST()
  const supabase = await createClient()
  const { items, entries, names, photoUrls } = await loadChecklist(supabase, date)
  const activeItems = items.filter((i) => i.is_active)

  function ItemRow({ item }: { item: ChecklistItem }) {
    const done = entries.find((e) => e.item_id === item.id && e.status === 'valid')
    const voided = entries.filter((e) => e.item_id === item.id && e.status === 'void')
    const canVoid = (e: ChecklistEntry) => isAdmin(me.role) || e.done_by === me.id

    return (
      <li id={`item-${item.id}`} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
        <div>
          {done ? '✅' : item.is_required ? '⬜' : '◻️'} <strong>{item.title}</strong>
          <span style={badge(item.is_required ? 'crimson' : '#888')}>{item.is_required ? '필수' : '선택'}</span>
          <span style={badge('#555')}>{TYPE_LABEL[item.item_type]}</span>
        </div>

        {done ? (
          <div style={{ marginLeft: 24 }}>
            {item.item_type === 'number' && <strong>{formatValue(item, done)} </strong>}
            {done.photo_path && photoUrls[done.photo_path] && (
              <a href={photoUrls[done.photo_path]} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrls[done.photo_path]} alt={item.title} style={{ height: 80, verticalAlign: 'middle' }} />
              </a>
            )}{' '}
            — {names[done.done_by] ?? '?'} · {formatTime(done.done_at)}
            {done.note && ` · 메모: ${done.note}`}
            {canVoid(done) && (
              <details style={{ display: 'inline-block', marginLeft: 8 }}>
                <summary>잘못 체크함</summary>
                <form action={voidEntry}>
                  <input type="hidden" name="entry_id" value={done.id} />
                  <input type="hidden" name="back" value="/checklist" />
                  <input name="reason" required placeholder="취소 사유" size={14} />{' '}
                  <ConfirmButton message="이 체크를 취소할까요? (기록에는 '취소됨'으로 남습니다)">취소</ConfirmButton>
                </form>
              </details>
            )}
          </div>
        ) : (
          <div style={{ marginLeft: 24 }}>
            {item.item_type === 'photo' ? (
              <PhotoUpload itemId={item.id} date={date} />
            ) : (
              <form action={completeItem}>
                <input type="hidden" name="item_id" value={item.id} />
                {item.item_type === 'number' && (
                  <>
                    <input
                      name="value"
                      type="text"
                      inputMode="decimal"
                      required
                      pattern="-?[0-9,]+(\.[0-9]+)?"
                      placeholder="숫자"
                      size={10}
                    />{' '}
                    {item.unit}{' '}
                  </>
                )}
                <button type="submit">완료</button>
              </form>
            )}
          </div>
        )}

        {voided.map((v) => (
          <div key={v.id} style={{ marginLeft: 24, fontSize: 12, color: '#999' }}>
            취소됨: {names[v.done_by] ?? '?'} {formatTime(v.done_at)} 체크
            {v.value_number !== null && ` (${formatValue(item, v)})`} → {names[v.voided_by ?? ''] ?? '?'}{' '}
            {formatTime(v.voided_at)} 취소 ({v.void_reason})
          </div>
        ))}
      </li>
    )
  }

  return (
    <main>
      {/* 다른 직원이 체크하면 바로 반영 */}
      <RealtimeRefresh table="checklist_entries" filter={`work_date=eq.${date}`} />
      <h1>오픈·마감 체크리스트 ({date})</h1>
      <p>
        한 명이 체크하면 모든 직원 화면에 바로 반영됩니다. <span style={badge('crimson')}>필수</span>는 꼭 해야 하는
        항목, <span style={badge('#888')}>선택</span>은 하면 좋은 항목입니다. 📷 항목은 사진을 찍어야, 🔢 항목은
        숫자를 입력해야 완료됩니다.
      </p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {ok && <p style={{ color: 'green' }}>{ok}</p>}

      {PHASES.map((phase) => {
        const p = progress(items, entries, phase)
        const allRequired = p.requiredDone === p.requiredTotal
        return (
          <section key={phase} style={{ border: '1px solid #ccc', padding: 12, marginBottom: 16 }}>
            <h2>
              {PHASE_LABEL[phase]}{' '}
              <span style={{ fontSize: 16, color: allRequired ? 'green' : 'crimson' }}>
                필수 {p.requiredDone}/{p.requiredTotal}
              </span>{' '}
              <span style={{ fontSize: 14, color: '#666' }}>
                (전체 {p.allDone}/{p.allTotal})
              </span>
            </h2>
            {phase === 'close' && (
              <p>
                마감 필수 항목을 모두 끝내야 <Link href="/sales">매출 정산 보고서</Link>를 저장할 수 있습니다.
              </p>
            )}
            {groupByCategory(activeItems.filter((i) => i.phase === phase)).map((g) => (
              <div key={g.category}>
                <h3 style={{ marginBottom: 0 }}>{g.category}</h3>
                <ul style={{ listStyle: 'none', paddingLeft: 0, marginTop: 4 }}>
                  {g.items.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )
      })}
    </main>
  )
}
