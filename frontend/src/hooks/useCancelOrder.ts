import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/api/payments/${orderId}/cancel`),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
