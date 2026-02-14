"use client";

import styled from "@emotion/styled";
import { useCart, CartItem as CartItemType } from "@/providers/CartProvider";

interface CartItemProps {
  item: CartItemType;
}

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} 0`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Info = styled.div`
  flex: 1;
  min-width: 0;
`;

const Name = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Price = styled.p`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const QuantityControl = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const QtyButton = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  background: ${({ theme }) => theme.colors.surface};
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.primary};

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const Quantity = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  min-width: 24px;
  text-align: center;
`;

const DeleteButton = styled.button`
  color: ${({ theme }) => theme.colors.danger};
  font-size: ${({ theme }) => theme.fontSize.xs};
  padding: ${({ theme }) => theme.spacing.xs};

  &:hover {
    opacity: 0.7;
  }
`;

export default function CartItem({ item }: CartItemProps) {
  const { dispatch } = useCart();

  const subtotal = item.menu.price * item.quantity;

  return (
    <Row>
      <Info>
        <Name>{item.menu.name}</Name>
        <Price>{subtotal.toLocaleString()}원</Price>
      </Info>
      <QuantityControl>
        <QtyButton
          onClick={() =>
            dispatch({
              type: "UPDATE_QUANTITY",
              menuId: item.menu.id,
              quantity: item.quantity - 1,
            })
          }
        >
          -
        </QtyButton>
        <Quantity>{item.quantity}</Quantity>
        <QtyButton
          onClick={() =>
            dispatch({
              type: "UPDATE_QUANTITY",
              menuId: item.menu.id,
              quantity: item.quantity + 1,
            })
          }
        >
          +
        </QtyButton>
      </QuantityControl>
      <DeleteButton
        onClick={() => dispatch({ type: "REMOVE_ITEM", menuId: item.menu.id })}
      >
        삭제
      </DeleteButton>
    </Row>
  );
}
