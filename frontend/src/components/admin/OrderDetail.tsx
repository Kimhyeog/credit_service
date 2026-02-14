"use client";

import styled from "@emotion/styled";
import { useOrder } from "@/hooks/useOrders";
import { useCancelOrder } from "@/hooks/useCancelOrder";
import OrderSourceBadge from "./OrderSourceBadge";

interface OrderDetailProps {
  orderId: string;
  onClose: () => void;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
`;

const Panel = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius.lg};
  padding: ${({ theme }) => theme.spacing.lg};
  width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px ${({ theme }) => theme.colors.shadow};
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h3`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CloseButton = styled.button`
  font-size: ${({ theme }) => theme.fontSize.lg};
  color: ${({ theme }) => theme.colors.text.disabled};
  padding: 4px 8px;
`;

const Section = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const SectionTitle = styled.h4`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const ItemRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: ${({ theme }) => `${theme.spacing.xs} 0`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: ${({ theme }) => `${theme.spacing.xs} 0`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const InfoValue = styled.span`
  color: ${({ theme }) => theme.colors.text.primary};
  font-weight: 500;
`;

const TotalRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding-top: ${({ theme }) => theme.spacing.sm};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const StatusText = styled.span<{ color: string }>`
  font-weight: 600;
  color: ${({ color }) => color};
`;

const CancelButton = styled.button`
  width: 100%;
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.danger};
  color: white;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  margin-top: ${({ theme }) => theme.spacing.md};

  &:disabled {
    opacity: 0.5;
  }
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

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("ko-KR");
}

export default function OrderDetail({ orderId, onClose }: OrderDetailProps) {
  const { data: order, isLoading } = useOrder(orderId);
  const cancelOrder = useCancelOrder();

  if (isLoading || !order) {
    return (
      <Overlay onClick={onClose}>
        <Panel onClick={(e) => e.stopPropagation()}>
          <p>로딩 중...</p>
        </Panel>
      </Overlay>
    );
  }

  const handleCancel = () => {
    if (!window.confirm("정말 이 주문을 취소하시겠습니까? 결제도 함께 취소됩니다."))
      return;
    cancelOrder.mutate(orderId, { onSuccess: onClose });
  };

  return (
    <Overlay onClick={onClose}>
      <Panel onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>주문 #{order.orderNumber}</Title>
          <CloseButton onClick={onClose}>X</CloseButton>
        </Header>

        <Section>
          <InfoRow>
            <span>상태</span>
            <StatusText color={STATUS_COLORS[order.status] ?? "#666"}>
              {order.status}
            </StatusText>
          </InfoRow>
          <InfoRow>
            <span>출처</span>
            <OrderSourceBadge source={order.source} />
          </InfoRow>
          <InfoRow>
            <span>주문 시간</span>
            <InfoValue>{formatDateTime(order.createdAt)}</InfoValue>
          </InfoRow>
          {order.tableId && (
            <InfoRow>
              <span>테이블</span>
              <InfoValue>{order.tableId}</InfoValue>
            </InfoRow>
          )}
        </Section>

        <Section>
          <SectionTitle>주문 항목</SectionTitle>
          {order.items.map((item) => (
            <ItemRow key={item.id}>
              <span>
                {item.menu?.name ?? "메뉴"} x{item.quantity}
              </span>
              <span>{(item.price * item.quantity).toLocaleString()}원</span>
            </ItemRow>
          ))}
          <TotalRow>
            <span>합계</span>
            <span>{order.totalAmount.toLocaleString()}원</span>
          </TotalRow>
        </Section>

        {order.payment && (
          <Section>
            <SectionTitle>결제 정보</SectionTitle>
            <InfoRow>
              <span>결제 상태</span>
              <InfoValue>{order.payment.status}</InfoValue>
            </InfoRow>
            {order.payment.method && (
              <InfoRow>
                <span>결제 수단</span>
                <InfoValue>{order.payment.method}</InfoValue>
              </InfoRow>
            )}
            {order.payment.approvedAt && (
              <InfoRow>
                <span>승인 시간</span>
                <InfoValue>
                  {formatDateTime(order.payment.approvedAt)}
                </InfoValue>
              </InfoRow>
            )}
          </Section>
        )}

        {order.status === "PAID" && (
          <CancelButton
            onClick={handleCancel}
            disabled={cancelOrder.isPending}
          >
            {cancelOrder.isPending ? "취소 중..." : "주문 취소"}
          </CancelButton>
        )}
      </Panel>
    </Overlay>
  );
}
