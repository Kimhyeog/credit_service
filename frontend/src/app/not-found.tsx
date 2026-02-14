import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        gap: "16px",
      }}
    >
      <h2 style={{ fontSize: "24px" }}>페이지를 찾을 수 없습니다</h2>
      <Link href="/" style={{ color: "#3182F6" }}>
        POS 화면으로 돌아가기
      </Link>
    </div>
  );
}
