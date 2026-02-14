"use client";

import styled from "@emotion/styled";

interface ButtonProps {
  variant?: "primary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

const StyledButton = styled.button<ButtonProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ size, theme }) =>
    size === "sm"
      ? `${theme.spacing.xs} ${theme.spacing.sm}`
      : size === "lg"
        ? `${theme.spacing.md} ${theme.spacing.lg}`
        : `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: ${({ size, theme }) =>
    size === "sm" ? theme.fontSize.sm : size === "lg" ? theme.fontSize.lg : theme.fontSize.md};
  font-weight: 600;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  width: ${({ fullWidth }) => (fullWidth ? "100%" : "auto")};
  transition: background-color 0.15s, opacity 0.15s;

  ${({ variant, theme }) => {
    switch (variant) {
      case "danger":
        return `
          background: ${theme.colors.danger};
          color: white;
          &:hover { opacity: 0.9; }
        `;
      case "ghost":
        return `
          background: transparent;
          color: ${theme.colors.text.secondary};
          &:hover { background: ${theme.colors.surfaceHover}; }
        `;
      default: // primary
        return `
          background: ${theme.colors.primary};
          color: white;
          &:hover { background: ${theme.colors.primaryHover}; }
        `;
    }
  }}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export default StyledButton;
