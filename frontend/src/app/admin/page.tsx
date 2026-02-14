export default function AdminPage() {
  return (
    <div style={{ padding: "32px" }}>
      <h1>관리자 대시보드</h1>
      <p>Phase 5에서 구현 예정</p>
      <nav style={{ marginTop: "16px", display: "flex", gap: "16px" }}>
        <a href="/admin/orders" style={{ color: "#3182F6" }}>
          KDS 주문현황 →
        </a>
        <a href="/" style={{ color: "#3182F6" }}>
          ← POS로 돌아가기
        </a>
      </nav>
    </div>
  );
}
