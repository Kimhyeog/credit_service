import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      api.patch(`/api/orders/${orderId}/status`, { status }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
