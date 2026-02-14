"use client";

import { useState, useMemo } from "react";
import styled from "@emotion/styled";
import { useMenus } from "@/hooks/useMenus";
import { useCart } from "@/providers/CartProvider";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import { createPaymentService } from "@/services/payment";
import { generateIdempotencyKey } from "@/utils/idempotency";
import CategoryTabs from "@/components/common/CategoryTabs";
import Button from "@/components/common/Button";
import type { MenuItem } from "@/types/menu";

interface KioskShellProps {
  initialMenus: MenuItem[];
}

const KioskLayout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 768px;
  margin: 0 auto;
  background: ${({ theme }) => theme.colors.background};
`;

const KioskHeader = styled.header`
  padding: ${({ theme }) => `${theme.spacing.xl} ${theme.spacing.md}`};
  text-align: center;
`;

const KioskTitle = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xxl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const KioskSubtitle = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const MenuArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.md};
`;

const MenuGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
`;

const KioskMenuItem = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.lg};
  transition: transform 0.1s;
  text-align: center;
  min-height: 160px;

  &:hover {
    transform: scale(1.02);
  }

  &:active {
    transform: scale(0.98);
  }
`;

const KioskMenuName = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const KioskMenuPrice = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const BottomBar = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
`;

const CartSummary = styled.div`
  flex: 1;
`;

const CartCount = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CartTotal = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  margin-left: ${({ theme }) => theme.spacing.md};
`;

export default function KioskShell({ initialMenus }: KioskShellProps) {
  const { data: menus } = useMenus(initialMenus);

  const { state, dispatch } = useCart();
  const createOrder = useCreateOrder();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set((menus ?? []).map((m) => m.category));
    return Array.from(cats);
  }, [menus]);

  const filteredMenus = useMemo(() => {
    if (activeCategory === null) return menus ?? [];
    return (menus ?? []).filter((m) => m.category === activeCategory);
  }, [menus, activeCategory]);

  const totalQuantity = state.items.reduce((sum, i) => sum + i.quantity, 0);

  const handleMenuClick = (menu: MenuItem) => {
    dispatch({ type: "ADD_ITEM", menu });
  };

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
            successUrl: `/payment/success?returnTo=/kiosk`,
            failUrl: `/payment/fail?returnTo=/kiosk`,
          });
        },
      },
    );
  };

  return (
    <KioskLayout>
      <KioskHeader>
        <KioskTitle>무엇을 주문하시겠어요?</KioskTitle>
        <KioskSubtitle>메뉴를 선택해주세요</KioskSubtitle>
      </KioskHeader>

      <CategoryTabs
        categories={categories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
      />

      <MenuArea>
        <MenuGrid>
          {filteredMenus.map((menu) => (
            <KioskMenuItem key={menu.id} onClick={() => handleMenuClick(menu)}>
              <KioskMenuName>{menu.name}</KioskMenuName>
              <KioskMenuPrice>{menu.price.toLocaleString()}원</KioskMenuPrice>
            </KioskMenuItem>
          ))}
        </MenuGrid>
      </MenuArea>

      {totalQuantity > 0 && (
        <BottomBar>
          <CartSummary>
            <CartCount>장바구니 {totalQuantity}개</CartCount>
            <CartTotal>{state.totalAmount.toLocaleString()}원</CartTotal>
          </CartSummary>
          <Button
            variant="primary"
            size="lg"
            onClick={handleOrder}
            disabled={createOrder.isPending}
          >
            {createOrder.isPending ? "주문 중..." : "주문하기"}
          </Button>
        </BottomBar>
      )}
    </KioskLayout>
  );
}
