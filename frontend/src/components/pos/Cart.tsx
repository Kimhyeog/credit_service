"use client";

import styled from "@emotion/styled";
import { useCart } from "@/providers/CartProvider";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import { createPaymentService } from "@/services/payment";
import { generateIdempotencyKey } from "@/utils/idempotency";
import CartItem from "./CartItem";
import Button from "@/components/common/Button";
import OrderModeToggle from "@/components/common/OrderModeToggle";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: ${({ theme }) => theme.colors.background};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
`;

const Header = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.h2`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const ItemList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => `0 ${theme.spacing.md}`};
`;

const EmptyMessage = styled.p`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.text.disabled};
  font-size: ${({ theme }) => theme.fontSize.sm};
`;

const Footer = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Summary = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SummaryLabel = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const SummaryAmount = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

export default function Cart() {
  const { state, dispatch } = useCart();
  const createOrder = useCreateOrder();

  const handleOrder = () => {
    if (state.items.length === 0) return;

    const idempotencyKey = generateIdempotencyKey(
      state.items.map((item) => ({ menuId: item.menu.id, quantity: item.quantity }))
    );

    createOrder.mutate(
      {
        items: state.items.map((item) => ({
          menu_id: item.menu.id,
          quantity: item.quantity,
        })),
        idempotency_key: idempotencyKey,
        order_mode: state.orderMode,
      },
      {
        onSuccess: async (order) => {
          const firstName = state.items[0]?.menu.name || "주문";
          const orderName =
            state.items.length > 1
              ? `${firstName} 외 ${state.items.length - 1}건`
              : firstName;

          dispatch({ type: "CLEAR" });

          const paymentService = createPaymentService();
          await paymentService.requestPayment({
            orderId: order.id,
            orderName,
            amount: order.totalAmount,
            successUrl: `/payment/success?returnTo=/`,
            failUrl: `/payment/fail?returnTo=/`,
          });
        },
      },
    );
  };

  const totalQuantity = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <Container>
      <Header>
        <Title>장바구니</Title>
      </Header>

      <ItemList>
        {state.items.length === 0 ? (
          <EmptyMessage>메뉴를 선택해주세요</EmptyMessage>
        ) : (
          state.items.map((item) => (
            <CartItem key={item.menu.id} item={item} />
          ))
        )}
      </ItemList>

      <Footer>
        <OrderModeToggle />

        <Summary>
          <SummaryLabel>
            총 {totalQuantity}개
          </SummaryLabel>
          <SummaryAmount>
            {state.totalAmount.toLocaleString()}원
          </SummaryAmount>
        </Summary>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={handleOrder}
          disabled={state.items.length === 0 || createOrder.isPending}
        >
          {createOrder.isPending ? "주문 생성 중..." : "결제하기"}
        </Button>
      </Footer>
    </Container>
  );
}
