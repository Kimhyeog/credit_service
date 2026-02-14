"use client";

export default function PaymentSuccessPage() {
  // Phase 9에서 useSearchParams()로 paymentKey, orderId, amount 추출
  // confirmPayment mutation 호출
  return (
    <div style={{ padding: "32px", textAlign: "center" }}>
      <h1 style={{ color: "#2BD67E" }}>결제 성공</h1>
      <p>Phase 9에서 구현 예정</p>
      <a href="/" style={{ color: "#3182F6" }}>
        ← POS로 돌아가기
      </a>
    </div>
  );
}
