"use client";

import styled from "@emotion/styled";
import type { OrderResponse } from "@/types/order";

interface SalesSummaryProps {
  orders: OrderResponse[];
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
`;

const Card = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.md};
  text-align: center;
`;

const CardLabel = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const CardValue = styled.p`
  font-size: ${({ theme }) => theme.fontSize.xxl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const PAID_STATUSES = ["PAID", "PREPARING", "COMPLETED"];

export default function SalesSummary({ orders }: SalesSummaryProps) {
  const paidOrders = orders.filter((o) => PAID_STATUSES.includes(o.status));
  const totalSales = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const count = paidOrders.length;
  const average = count > 0 ? Math.round(totalSales / count) : 0;

  return (
    <Grid>
      <Card>
        <CardLabel>오늘 매출</CardLabel>
        <CardValue>{totalSales.toLocaleString()}원</CardValue>
      </Card>
      <Card>
        <CardLabel>주문 건수</CardLabel>
        <CardValue>{count}건</CardValue>
      </Card>
      <Card>
        <CardLabel>평균 단가</CardLabel>
        <CardValue>{average.toLocaleString()}원</CardValue>
      </Card>
    </Grid>
  );
}
