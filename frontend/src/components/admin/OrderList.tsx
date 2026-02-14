"use client";

import { useState } from "react";
import styled from "@emotion/styled";
import OrderSourceBadge from "./OrderSourceBadge";
import type { OrderResponse } from "@/types/order";

interface OrderListProps {
  orders: OrderResponse[];
  onSelect: (orderId: string) => void;
}

const STATUS_TABS: { key: string | null; label: string }[] = [
  { key: null, label: "전체" },
  { key: "active", label: "진행중" },
  { key: "completed", label: "완료" },
  { key: "cancelled", label: "취소" },
];

const ACTIVE_STATUSES = ["PENDING", "PAYMENT_PENDING", "PAID", "PREPARING"];
const COMPLETED_STATUSES = ["COMPLETED"];
const CANCELLED_STATUSES = ["CANCELLED", "FAILED"];

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const TabRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Tab = styled.button<{ active: boolean }>`
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  background: ${({ active, theme }) =>
    active ? theme.colors.primary : theme.colors.surface};
  color: ${({ active, theme }) =>
    active ? "white" : theme.colors.text.secondary};
  transition: background-color 0.15s;
`;

const Table = styled.div`
  display: flex;
  flex-direction: column;
`;

const Row = styled.button`
  display: grid;
  grid-template-columns: 60px 1fr 100px 100px 80px 80px;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  text-align: left;
  transition: background-color 0.1s;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const OrderNum = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const ItemSummary = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Amount = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  text-align: right;
`;

const StatusBadge = styled.span<{ color: string }>`
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  color: ${({ color }) => color};
`;

const TimeText = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.text.disabled};
  text-align: right;
`;

const EmptyMessage = styled.p`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.text.disabled};
  font-size: ${({ theme }) => theme.fontSize.sm};
`;

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#FF9F00",
  PAYMENT_PENDING: "#FF9F00",
  PAID: "#3182F6",
  PREPARING: "#8B5CF6",
  COMPLETED: "#2BD67E",
  CANCELLED: "#F04452",
  FAILED: "#F04452",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  PAYMENT_PENDING: "결제중",
  PAID: "결제완료",
  PREPARING: "준비중",
  COMPLETED: "완료",
  CANCELLED: "취소",
  FAILED: "실패",
};

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function summarizeItems(order: OrderResponse) {
  if (order.items.length === 0) return "-";
  const first = order.items[0].menu?.name ?? "메뉴";
  if (order.items.length === 1) return `${first} x${order.items[0].quantity}`;
  return `${first} x${order.items[0].quantity} 외 ${order.items.length - 1}건`;
}

export default function OrderList({ orders, onSelect }: OrderListProps) {
  const [tab, setTab] = useState<string | null>(null);

  const filtered = orders.filter((o) => {
    if (tab === null) return true;
    if (tab === "active") return ACTIVE_STATUSES.includes(o.status);
    if (tab === "completed") return COMPLETED_STATUSES.includes(o.status);
    if (tab === "cancelled") return CANCELLED_STATUSES.includes(o.status);
    return true;
  });

  return (
    <Wrapper>
      <TabRow>
        {STATUS_TABS.map((t) => (
          <Tab
            key={t.key ?? "all"}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Tab>
        ))}
      </TabRow>

      <Table>
        {filtered.length === 0 ? (
          <EmptyMessage>주문이 없습니다</EmptyMessage>
        ) : (
          filtered.map((order) => (
            <Row key={order.id} onClick={() => onSelect(order.id)}>
              <OrderNum>#{order.orderNumber}</OrderNum>
              <ItemSummary>{summarizeItems(order)}</ItemSummary>
              <Amount>{order.totalAmount.toLocaleString()}원</Amount>
              <StatusBadge color={STATUS_COLORS[order.status] ?? "#666"}>
                {STATUS_LABELS[order.status] ?? order.status}
              </StatusBadge>
              <OrderSourceBadge source={order.source} />
              <TimeText>{formatTime(order.createdAt)}</TimeText>
            </Row>
          ))
        )}
      </Table>
    </Wrapper>
  );
}
