"use client";

import styled from "@emotion/styled";
import { useCart } from "@/providers/CartProvider";
import type { OrderMode } from "@/types/order";

const ToggleContainer = styled.div`
  display: flex;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const ToggleOption = styled.button<{ isActive: boolean }>`
  flex: 1;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  transition: all 0.15s;

  ${({ isActive, theme }) =>
    isActive
      ? `
        background: ${theme.colors.primary};
        color: white;
      `
      : `
        background: ${theme.colors.background};
        color: ${theme.colors.text.secondary};
        &:hover {
          background: ${theme.colors.surfaceHover};
        }
      `}
`;

export default function OrderModeToggle() {
  const { state, dispatch } = useCart();

  const handleSelect = (mode: OrderMode) => {
    dispatch({ type: "SET_ORDER_MODE", mode });
  };

  return (
    <ToggleContainer>
      <ToggleOption
        isActive={state.orderMode === "DINE_IN"}
        onClick={() => handleSelect("DINE_IN")}
      >
        매장
      </ToggleOption>
      <ToggleOption
        isActive={state.orderMode === "TAKE_OUT"}
        onClick={() => handleSelect("TAKE_OUT")}
      >
        포장
      </ToggleOption>
    </ToggleContainer>
  );
}
