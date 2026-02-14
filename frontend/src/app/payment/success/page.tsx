"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import styled from "@emotion/styled";
import { createPaymentService } from "@/services/payment";
import type { PaymentResult } from "@/services/payment";
import { WALManager } from "@/services/recovery/WALManager";
import { forceReleaseLock } from "@/hooks/usePaymentLock";
import Button from "@/components/common/Button";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.colors.background};
`;

const IconCircle = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.success};
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  font-size: 40px;
  color: white;
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xxl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Amount = styled.p`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Info = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const ErrorText = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.danger};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const LoadingText = styled.p`
  font-size: ${({ theme }) => theme.fontSize.lg};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

type Status = "loading" | "success" | "error";

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [error, setError] = useState<string>("");
  const confirmedRef = useRef(false);

  const returnTo = searchParams.get("returnTo") || "/";

  useEffect(() => {
    // 재진입 방지 — Strict Mode, searchParams 재평가 등에서 중복 호출 차단
    if (confirmedRef.current) return;

    const paymentKey = searchParams.get("paymentKey");
    const orderId = searchParams.get("orderId");
    const amount = searchParams.get("amount");

    if (!paymentKey || !orderId || !amount) {
      setStatus("error");
      setError("결제 정보가 누락되었습니다.");
      forceReleaseLock();
      return;
    }

    confirmedRef.current = true;

    const paymentService = createPaymentService();
    paymentService
      .confirmPayment({
        paymentKey,
        orderId,
        amount: Number(amount),
      })
      .then((res) => {
        setResult(res);
        setStatus("success");

        // WAL에서 해당 주문 정리
        const wal = new WALManager();
        const entries = wal.readAll().filter((e) => e.orderId === orderId);
        entries.forEach((e) => wal.remove(e.id));
      })
      .catch((err) => {
        confirmedRef.current = false; // 실패 시 새로고침으로 재시도 허용
        setError(err.detail || "결제 승인에 실패했습니다.");
        setStatus("error");
      })
      .finally(() => {
        forceReleaseLock();
      });
  }, [searchParams]);

  if (status === "loading") {
    return (
      <Container>
        <LoadingText>결제를 확인하고 있습니다...</LoadingText>
      </Container>
    );
  }

  if (status === "error") {
    return (
      <Container>
        <Title>결제 승인 실패</Title>
        <ErrorText>{error}</ErrorText>
        <Button variant="primary" size="lg" onClick={() => router.push(returnTo)}>
          돌아가기
        </Button>
      </Container>
    );
  }

  return (
    <Container>
      <IconCircle>&#10003;</IconCircle>
      <Title>결제가 완료되었습니다</Title>
      <Amount>{result!.amount.toLocaleString()}원</Amount>
      {result!.method && <Info>결제 수단: {result!.method}</Info>}
      {result!.approvedAt && (
        <Info>승인 시각: {new Date(result!.approvedAt).toLocaleString("ko-KR")}</Info>
      )}
      <div style={{ marginTop: "24px" }}>
        <Button variant="primary" size="lg" onClick={() => router.push(returnTo)}>
          돌아가기
        </Button>
      </div>
    </Container>
  );
}
