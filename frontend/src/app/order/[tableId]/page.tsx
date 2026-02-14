export default async function TableOrderPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  return (
    <div style={{ padding: "32px", textAlign: "center" }}>
      <h1>테이블오더 — 테이블 {tableId}</h1>
      <p>Phase 5에서 구현 예정</p>
      <a href="/" style={{ color: "#3182F6" }}>
        ← POS로 돌아가기
      </a>
    </div>
  );
}
