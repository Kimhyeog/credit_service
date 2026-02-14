"use client";

import styled from "@emotion/styled";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const Banner = styled.div`
  background: ${({ theme }) => theme.colors.warning};
  color: white;
  text-align: center;
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
`;

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return <Banner>인터넷 연결이 끊어졌습니다. 연결을 확인해주세요.</Banner>;
}
