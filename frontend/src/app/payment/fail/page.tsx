"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import styled from "@emotion/styled";
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
  background: ${({ theme }) => theme.colors.danger};
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

const ErrorCode = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.disabled};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const ErrorMessage = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.xl};
  text-align: center;
`;

export default function PaymentFailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // 페이지 진입 시 결제 잠금 해제
  useEffect(() => {
    forceReleaseLock();
  }, []);

  const code = searchParams.get("code") || "UNKNOWN_ERROR";
  const message = searchParams.get("message") || "결제 중 오류가 발생했습니다.";
  const returnTo = searchParams.get("returnTo") || "/";

  return (
    <Container>
      <IconCircle>&#10007;</IconCircle>
      <Title>결제 실패</Title>
      <ErrorCode>오류 코드: {code}</ErrorCode>
      <ErrorMessage>{message}</ErrorMessage>
      <Button variant="primary" size="lg" onClick={() => router.push(returnTo)}>
        돌아가기
      </Button>
    </Container>
  );
}
