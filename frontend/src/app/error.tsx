"use client"; // error.tsx는 반드시 Client Component

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
      <h2 style={{ fontSize: "20px", color: "#F04452" }}>
        문제가 발생했습니다
      </h2>
      <p style={{ color: "#666" }}>{error.message}</p>
      <button
        onClick={reset}
        style={{
          padding: "8px 16px",
          background: "#3182F6",
          color: "white",
          borderRadius: "8px",
          border: "none",
          cursor: "pointer",
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
