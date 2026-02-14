import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { OrderResponse, OrderCreateRequest } from "@/types/order";

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation<
    OrderResponse,
    Error,
    OrderCreateRequest,
    { previous: OrderResponse[] | undefined }
  >({
    mutationFn: (body) =>
      api.post<OrderResponse>("/api/orders", body, {
        headers: { "Idempotency-Key": body.idempotency_key },
      }),

    // 낙관적 업데이트: 서버 응답 전에 UI에 주문 추가
    onMutate: async (newOrder) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      const previous = queryClient.getQueryData<OrderResponse[]>(["orders"]);
      return { previous };
    },

    // 성공: 서버 데이터로 교체
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },

    // 실패: 롤백
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["orders"], context.previous);
      }
    },
  });
}
