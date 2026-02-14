"use client";

import styled from "@emotion/styled";

const Badge = styled.span<{ bg: string; fg: string }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  background: ${({ bg }) => bg};
  color: ${({ fg }) => fg};
`;

const SOURCE_CONFIG: Record<string, { label: string; fg: string; bg: string }> =
  {
    POS: { label: "POS", fg: "#3182F6", bg: "#3182F620" },
    KIOSK: { label: "키오스크", fg: "#8B5CF6", bg: "#8B5CF620" },
    TABLE: { label: "테이블", fg: "#10B981", bg: "#10B98120" },
  };

export default function OrderSourceBadge({ source }: { source: string }) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.POS;
  return (
    <Badge fg={config.fg} bg={config.bg}>
      {config.label}
    </Badge>
  );
}
