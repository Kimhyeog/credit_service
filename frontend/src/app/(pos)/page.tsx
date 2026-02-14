export default function POSPage() {
  return (
    <div style={{ padding: "32px" }}>
      <h1>Toss-Sync POS</h1>
      <p>Phase 4 완료 — Provider 계층 + 라우트 구조 정상 동작 확인</p>
      <nav style={{ marginTop: "16px", display: "flex", gap: "16px" }}>
        <a href="/kiosk" style={{ color: "#3182F6" }}>
          키오스크 →
        </a>
        <a href="/order/1" style={{ color: "#3182F6" }}>
          테이블오더 →
        </a>
        <a href="/admin" style={{ color: "#3182F6" }}>
          관리자 →
        </a>
      </nav>
    </div>
  );
}
