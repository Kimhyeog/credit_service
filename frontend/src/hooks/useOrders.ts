import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { OrderResponse } from "@/types/order";

/** 주문 목록 — 3초 간격 폴링 */
export function useOrders(status?: string) {
  return useQuery<OrderResponse[]>({
    queryKey: ["orders", { status }],
    queryFn: () => api.get<OrderResponse[]>("/api/orders", { params: { status } }),
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });
}

/** 주문 상세 */
export function useOrder(orderId: string) {
  return useQuery<OrderResponse>({
    queryKey: ["orders", orderId],
    queryFn: () => api.get<OrderResponse>(`/api/orders/${orderId}`),
    enabled: !!orderId,
  });
}
