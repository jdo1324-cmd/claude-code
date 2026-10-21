import Link from 'next/link'
import { addItem, moveItem, setItemActive, updateItem } from '@/app/(app)/checklist/actions'
import { requireOwner } from '@/lib/auth'
import { PHASES, PHASE_LABEL, TYPE_LABEL, groupByCategory, type ChecklistItem, type Phase } from '@/lib/checklist'
import { createClient } from '@/lib/supabase/server'

const BACK = '/admin/checklist-items'

// 매출 정산 화면이 이 이름으로 오늘 포스 금액을 찾아 미리 채움 → 이름은 바꾸지 않게 막음
const LOCKED_TITLES: Record<string, string> = {
  '포스 매출 마감 금액': '매출 정산 화면이 이 항목의 금액을 가져다 씁니다. 그래서 이름은 바꿀 수 없습니다.',
}

function TypeSelect({ defaultValue }: { defaultValue: ChecklistItem['item_type'] }) {
  return (
    <select name="item_type" defaultValue={defaultValue}>
      <option value="check">✔ 체크만</option>
      <option value="number">🔢 숫자 입력</option>
      <option value="photo">📷 사진 촬영</option>
    </select>
  )
}

// 항목 추가 · 수정에 같이 쓰는 입력 칸
function ItemFields({ item }: { item?: ChecklistItem }) {
  const locked = item ? LOCKED_TITLES[item.title] : undefined
  return (
    <div className="item-fields">
      <label>
        업무 구분
        <input name="category" required defaultValue={item?.category} placeholder="예: 매장 오픈" list="categories" />
      </label>
      <label>
        항목 이름
        <input
          name="title"
          required
          defaultValue={item?.title}
          placeholder="예: 정수기 필터 확인"
          readOnly={!!locked}
        />
      </label>
      {locked && <p className="small muted">🔒 {locked}</p>}
      <label>
        확인 방법
        <TypeSelect defaultValue={item?.item_type ?? 'check'} />
      </label>
      <label className="unit-field">
        단위 (숫자 입력일 때)
        <input name="unit" defaultValue={item?.unit ?? ''} placeholder="예: ℃, 원, 개" />
      </label>
      <label className="check-label">
        <input type="checkbox" name="is_required" defaultChecked={item ? item.is_required : true} /> 필수 항목
        <span className="small muted"> (끄면 &quot;선택&quot; 항목)</span>
      </label>
    </div>
  )
}

function ItemCard({ item, first, last }: { item: ChecklistItem; first: boolean; last: boolean }) {
  return (
    <li className="item-row">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <span className="check-title">{item.title}</span>
          <div style={{ marginTop: 4 }}>
            <span className={item.is_required ? 'badge badge-danger' : 'badge'} style={{ marginLeft: 0 }}>
              {item.is_required ? '필수' : '선택'}
            </span>
            <span className="badge">
              {TYPE_LABEL[item.item_type]}
              {item.unit && ` (${item.unit})`}
            </span>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
          <form action={moveItem}>
            <input type="hidden" name="item_id" value={item.id} />
            <input type="hidden" name="direction" value="up" />
            <input type="hidden" name="back" value={BACK} />
            <button type="submit" className="btn-secondary icon-btn" disabled={first} aria-label="위로">
              ▲
            </button>
          </form>
          <form action={moveItem}>
            <input type="hidden" name="item_id" value={item.id} />
            <input type="hidden" name="direction" value="down" />
            <input type="hidden" name="back" value={BACK} />
            <button type="submit" className="btn-secondary icon-btn" disabled={last} aria-label="아래로">
              ▼
            </button>
          </form>
        </div>
      </div>

      <details>
        <summary className="small">수정하기</summary>
        <form action={updateItem}>
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="back" value={BACK} />
          <ItemFields item={item} />
          <p className="small muted">
            확인 방법(체크/숫자/사진)을 바꾸면, 이미 기록이 있는 항목은 새 항목으로 만들어지고 기존 항목은 사용
            중지됩니다. 지난 기록은 그대로 남습니다.
          </p>
          <button type="submit">저장</button>
        </form>
        <form action={setItemActive} style={{ marginTop: 12 }}>
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="active" value="0" />
          <input type="hidden" name="back" value={BACK} />
          <button type="submit" className="btn-secondary">
            사용 중지 (목록에서 빼기)
          </button>
        </form>
      </details>
    </li>
  )
}

export default async function ChecklistItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  await requireOwner()
  const supabase = await createClient()
  const { data } = await supabase.from('checklist_items').select('*').order('phase').order('sort_order').order('id')
  const items = (data ?? []) as ChecklistItem[]
  const active = items.filter((i) => i.is_active)
  const inactive = items.filter((i) => !i.is_active)
  const categories = [...new Set(items.map((i) => i.category))]

  return (
    <main>
      <div className="page-head">
        <h1>체크리스트 항목 설정</h1>
      </div>
      <p className="small muted">
        여기서 바꾼 내용은 바로 직원들의 <Link href="/checklist">체크리스트 화면</Link>에 반영됩니다. 항목은 지우지 않고
        &quot;사용 중지&quot;합니다. 그래서 지난 기록은 그대로 남습니다.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      {ok && <p className="alert alert-ok">{ok}</p>}
      {/* 업무 구분 입력 칸에서 기존 구분을 골라 쓸 수 있게 */}
      <datalist id="categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {PHASES.map((phase: Phase) => {
        const phaseItems = active.filter((i) => i.phase === phase)
        return (
          <section key={phase}>
            <h2>{PHASE_LABEL[phase]}</h2>
            {phaseItems.length === 0 && <p className="muted">항목이 없습니다.</p>}
            {groupByCategory(phaseItems).map((g) => (
              <div key={g.category}>
                <h3 style={{ marginBottom: 0 }}>{g.category}</h3>
                <ul className="check-list">
                  {g.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      first={item.id === phaseItems[0].id}
                      last={item.id === phaseItems[phaseItems.length - 1].id}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )
      })}

      <section id="add">
        <h2>새 항목 추가</h2>
        <form action={addItem}>
          <input type="hidden" name="back" value={BACK} />
          <div className="item-fields">
            <label>
              오픈 / 마감
              <select name="phase" defaultValue="open">
                <option value="open">오픈 업무</option>
                <option value="close">마감 업무</option>
              </select>
            </label>
          </div>
          <ItemFields />
          <button type="submit">추가</button>
        </form>
      </section>

      {inactive.length > 0 && (
        <section>
          <h2>사용 중지된 항목</h2>
          <ul className="check-list">
            {inactive.map((item) => (
              <li key={item.id} className="item-row">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="muted">
                    [{PHASE_LABEL[item.phase]}] {item.category} · {item.title}
                    <span className="badge">{TYPE_LABEL[item.item_type]}</span>
                  </div>
                  <form action={setItemActive}>
                    <input type="hidden" name="item_id" value={item.id} />
                    <input type="hidden" name="active" value="1" />
                    <input type="hidden" name="back" value={BACK} />
                    <button type="submit" className="btn-secondary">
                      다시 사용
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
