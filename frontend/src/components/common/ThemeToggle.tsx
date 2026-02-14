"use client";

import styled from "@emotion/styled";
import { useThemeMode } from "@/providers/ThemeProvider";

const ToggleButton = styled.button`
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  background: ${({ theme }) => theme.colors.surface};
  font-size: ${({ theme }) => theme.fontSize.lg};
  transition: background-color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

export default function ThemeToggle() {
  const { mode, toggle } = useThemeMode();

  return (
    <ToggleButton onClick={toggle} aria-label="테마 전환">
      {mode === "light" ? "\u{1F319}" : "\u{2600}\u{FE0F}"}
    </ToggleButton>
  );
}
