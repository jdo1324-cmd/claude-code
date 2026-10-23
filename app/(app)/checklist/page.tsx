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
      <li id={`item-${item.id}`} className={done ? 'check-item is-done' : 'check-item'}>
        <span
          className={done ? 'check-mark done' : item.is_required ? 'check-mark required' : 'check-mark'}
          aria-label={done ? '완료' : '미완료'}
        >
          {done ? '✓' : ''}
        </span>
        <div>
          <span className="check-title">{item.title}</span>
          <span className={item.is_required ? 'badge badge-danger' : 'badge'}>
            {item.is_required ? '필수' : '선택'}
          </span>
          <span className="badge">{TYPE_LABEL[item.item_type]}</span>
        </div>

        {done ? (
          <div className="check-body small muted">
            {item.item_type === 'number' && <strong>{formatValue(item, done)} </strong>}
            {done.photo_path && photoUrls[done.photo_path] && (
              <a href={photoUrls[done.photo_path]} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrls[done.photo_path]}
                  alt={item.title}
                  style={{ height: 80, verticalAlign: 'middle', margin: '4px 0' }}
                />
              </a>
            )}{' '}
            — {names[done.done_by] ?? '?'} · {formatTime(done.done_at)}
            {done.note && ` · 메모: ${done.note}`}
            {canVoid(done) && (
              <details style={{ marginTop: 4 }}>
                <summary className="small">잘못 체크함</summary>
                <form action={voidEntry} className="row">
                  <input type="hidden" name="entry_id" value={done.id} />
                  <input type="hidden" name="back" value="/checklist" />
                  <input name="reason" required placeholder="취소 사유" size={14} />{' '}
                  <ConfirmButton message="이 체크를 취소할까요? (기록에는 '취소됨'으로 남습니다)">취소</ConfirmButton>
                </form>
              </details>
            )}
          </div>
        ) : (
          <div className="check-body" style={{ marginTop: 6 }}>
            {item.item_type === 'photo' ? (
              <PhotoUpload itemId={item.id} date={date} />
            ) : (
              <form action={completeItem} className="row">
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
          <div key={v.id} className="check-body small faint">
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
      <div className="page-head">
        <h1>오늘 체크리스트</h1>
        <span className="muted">{date}</span>
      </div>
      <p className="small muted">
        한 명이 체크하면 모든 직원 화면에 바로 반영됩니다.{' '}
        <span className="badge badge-danger" style={{ marginLeft: 0 }}>
          필수
        </span>
        는 꼭 해야 하는 항목,{' '}
        <span className="badge" style={{ marginLeft: 0 }}>
          선택
        </span>
        은 하면 좋은 항목입니다. 📷 항목은 사진을 찍어야, 🔢 항목은 숫자를 입력해야 완료됩니다.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}

      {PHASES.map((phase) => {
        const p = progress(items, entries, phase)
        if (p.allTotal === 0) return null // 오늘 할 항목이 없는 구분 (예: 미들 항목이 없는 요일)
        const allRequired = p.requiredDone === p.requiredTotal
        return (
          <section key={phase}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{PHASE_LABEL[phase]}</h2>
              <span className={allRequired ? 'badge badge-ok' : 'badge badge-danger'}>
                필수 {p.requiredDone}/{p.requiredTotal}
              </span>
            </div>
            <div className={p.allDone === p.allTotal ? 'progress complete' : 'progress'}>
              <span style={{ width: `${p.allTotal ? (p.allDone / p.allTotal) * 100 : 0}%` }} />
            </div>
            <div className="small muted">
              전체 {p.allDone}/{p.allTotal} 완료
            </div>
            {phase === 'close' && (
              <p className="alert alert-info small">
                마감 필수 항목을 모두 끝내야 <Link href="/sales">매출 정산 보고서</Link>를 저장할 수 있습니다.
              </p>
            )}
            {groupByCategory(activeItems.filter((i) => i.phase === phase)).map((g) => (
              <div key={g.category}>
                <h3 style={{ marginBottom: 0 }}>{g.category}</h3>
                <ul className="check-list">
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
