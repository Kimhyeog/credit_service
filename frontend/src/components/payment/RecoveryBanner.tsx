"use client";

import styled from "@emotion/styled";

interface RecoveryBannerProps {
  recoveredCount: number;
  needsManualCount: number;
  onDismiss: () => void;
}

const Banner = styled.div<{ variant: "success" | "warning" }>`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  background: ${({ variant, theme }) =>
    variant === "success" ? theme.colors.success : theme.colors.warning};
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
`;

const DismissButton = styled.button`
  background: rgba(255, 255, 255, 0.3);
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
`;

export default function RecoveryBanner({
  recoveredCount,
  needsManualCount,
  onDismiss,
}: RecoveryBannerProps) {
  if (needsManualCount > 0) {
    return (
      <Banner variant="warning">
        <span>
          수동 확인 필요: {needsManualCount}건의 미완료 결제가 있습니다
        </span>
        <DismissButton onClick={onDismiss}>닫기</DismissButton>
      </Banner>
    );
  }

  return (
    <Banner variant="success">
      <span>자동 복구 완료: {recoveredCount}건의 결제가 복구되었습니다</span>
      <DismissButton onClick={onDismiss}>닫기</DismissButton>
    </Banner>
  );
}
