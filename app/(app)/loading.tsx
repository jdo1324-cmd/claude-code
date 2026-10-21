// 화면을 옮길 때 바로 보이는 자리 표시 (데이터를 불러오는 동안)
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="불러오는 중">
      <div className="skeleton" style={{ height: 32, width: '40%', marginBottom: 20 }} />
      <div className="skeleton" style={{ height: 140, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 220 }} />
    </main>
  )
}
