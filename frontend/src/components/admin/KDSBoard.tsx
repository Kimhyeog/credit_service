"use client";

import styled from "@emotion/styled";
import { useUpdateOrderStatus } from "@/hooks/useUpdateOrderStatus";
import OrderSourceBadge from "./OrderSourceBadge";
import type { OrderResponse } from "@/types/order";

interface KDSBoardProps {
  orders: OrderResponse[];
}

const Board = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
  height: 100%;
  overflow: hidden;
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.md};
  overflow: hidden;
`;

const ColumnHeader = styled.div<{ color: string }>`
  padding: ${({ theme }) => theme.spacing.md};
  font-weight: 700;
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ color }) => color};
  border-bottom: 2px solid ${({ color }) => color};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Count = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
`;

const CardList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.sm};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  padding: ${({ theme }) => theme.spacing.md};
  box-shadow: 0 1px 3px ${({ theme }) => theme.colors.shadow};
`;

const CardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const OrderNum = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CardTime = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.text.disabled};
`;

const CardItems = styled.div`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const CardFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ActionButton = styled.button<{ color: string }>`
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  background: ${({ color }) => color};
  color: white;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;

  &:disabled {
    opacity: 0.5;
  }
`;

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function itemSummary(order: OrderResponse) {
  return order.items.map((i) => `${i.menu?.name ?? "메뉴"} x${i.quantity}`);
}

interface ColumnConfig {
  title: string;
  color: string;
  statuses: string[];
  action?: { label: string; nextStatus: string; color: string };
}

const COLUMNS: ColumnConfig[] = [
  {
    title: "접수",
    color: "#3182F6",
    statuses: ["PAID"],
    action: { label: "준비 시작", nextStatus: "PREPARING", color: "#8B5CF6" },
  },
  {
    title: "준비중",
    color: "#8B5CF6",
    statuses: ["PREPARING"],
    action: { label: "완료", nextStatus: "COMPLETED", color: "#2BD67E" },
  },
  {
    title: "완료",
    color: "#2BD67E",
    statuses: ["COMPLETED"],
  },
  {
    title: "취소",
    color: "#F04452",
    statuses: ["CANCELLED", "FAILED"],
  },
];

export default function KDSBoard({ orders }: KDSBoardProps) {
  const updateStatus = useUpdateOrderStatus();

  const handleStatusChange = (orderId: string, status: string) => {
    updateStatus.mutate({ orderId, status });
  };

  return (
    <Board>
      {COLUMNS.map((col) => {
        const colOrders = orders.filter((o) =>
          col.statuses.includes(o.status)
        );

        return (
          <Column key={col.title}>
            <ColumnHeader color={col.color}>
              <span>{col.title}</span>
              <Count>{colOrders.length}건</Count>
            </ColumnHeader>
            <CardList>
              {colOrders.map((order) => (
                <Card key={order.id}>
                  <CardHeader>
                    <OrderNum>#{order.orderNumber}</OrderNum>
                    <CardTime>{formatTime(order.createdAt)}</CardTime>
                  </CardHeader>
                  <CardItems>
                    {itemSummary(order).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </CardItems>
                  <CardFooter>
                    <OrderSourceBadge source={order.source} />
                    {col.action && (
                      <ActionButton
                        color={col.action.color}
                        disabled={updateStatus.isPending}
                        onClick={() =>
                          handleStatusChange(order.id, col.action!.nextStatus)
                        }
                      >
                        {col.action.label}
                      </ActionButton>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </CardList>
          </Column>
        );
      })}
    </Board>
  );
}
