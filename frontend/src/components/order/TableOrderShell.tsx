"use client";

import { useState, useMemo } from "react";
import styled from "@emotion/styled";
import { useMenus } from "@/hooks/useMenus";
import { useCart } from "@/providers/CartProvider";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import { usePayment } from "@/hooks/usePayment";
import { generateIdempotencyKey } from "@/utils/idempotency";
import CategoryTabs from "@/components/common/CategoryTabs";
import Button from "@/components/common/Button";
import OfflineBanner from "@/components/common/OfflineBanner";
import type { MenuItem } from "@/types/menu";

interface TableOrderShellProps {
  tableId: string;
  initialMenus: MenuItem[];
}

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 480px;
  margin: 0 auto;
  background: ${({ theme }) => theme.colors.background};
`;

const Header = styled.header`
  padding: ${({ theme }) => theme.spacing.md};
  text-align: center;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const TableBadge = styled.div`
  display: inline-block;
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const MenuArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`;

const MenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const MenuRow = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.md};
  width: 100%;
  text-align: left;
  transition: background-color 0.15s;

  &:active {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const MenuInfo = styled.div`
  flex: 1;
`;

const MenuName = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const MenuPrice = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: 2px;
`;

const AddBadge = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  color: ${({ theme }) => theme.colors.primary};
`;

const BottomBar = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const CartInfo = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const CartLabel = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const CartAmount = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

export default function TableOrderShell({ tableId, initialMenus }: TableOrderShellProps) {
  const { data: menus } = useMenus(initialMenus);

  const { state, dispatch } = useCart();
  const createOrder = useCreateOrder();
  const { state: paymentState, startPayment } = usePayment();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const isProcessing = createOrder.isPending || paymentState !== "IDLE";

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

    const firstName = state.items[0]?.menu.name || "주문";
    const orderName =
      state.items.length > 1
        ? `${firstName} 외 ${state.items.length - 1}건`
        : firstName;

    startPayment({
      items: state.items.map((item) => ({
        menuId: item.menu.id,
        quantity: item.quantity,
        name: item.menu.name,
      })),
      amount: state.totalAmount,
      idempotencyKey,
      orderName,
      successUrl: `/payment/success?returnTo=/order/${tableId}`,
      failUrl: `/payment/fail?returnTo=/order/${tableId}`,
      onOrderCreate: async () => {
        const order = await createOrder.mutateAsync({
          items: state.items.map((item) => ({
            menu_id: item.menu.id,
            quantity: item.quantity,
          })),
          idempotency_key: idempotencyKey,
          order_mode: "DINE_IN",
          source: "TABLE",
          table_id: tableId,
        });
        return order;
      },
    });
  };

  return (
    <Layout>
      <OfflineBanner />
      <Header>
        <TableBadge>테이블 {tableId}</TableBadge>
        <Title>메뉴를 선택해주세요</Title>
      </Header>

      <CategoryTabs
        categories={categories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
      />

      <MenuArea>
        <MenuList>
          {filteredMenus.map((menu) => (
            <MenuRow key={menu.id} onClick={() => handleMenuClick(menu)}>
              <MenuInfo>
                <MenuName>{menu.name}</MenuName>
                <MenuPrice>{menu.price.toLocaleString()}원</MenuPrice>
              </MenuInfo>
              <AddBadge>+</AddBadge>
            </MenuRow>
          ))}
        </MenuList>
      </MenuArea>

      {totalQuantity > 0 && (
        <BottomBar>
          <CartInfo>
            <CartLabel>{totalQuantity}개 선택</CartLabel>
            <CartAmount>{state.totalAmount.toLocaleString()}원</CartAmount>
          </CartInfo>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleOrder}
            disabled={isProcessing}
          >
            {isProcessing ? "결제 진행 중..." : "주문하기"}
          </Button>
        </BottomBar>
      )}
    </Layout>
  );
}
