import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { MenuItem } from "@/types/menu";

/**
 * 메뉴 목록 조회
 * - Server Component에서 initialData를 전달받으면 즉시 렌더링
 * - 이후 staleTime(5초) 경과 시 백그라운드 리페치
 */
export function useMenus(initialData?: MenuItem[]) {
  return useQuery<MenuItem[]>({
    queryKey: ["menus"],
    queryFn: () => api.get<MenuItem[]>("/api/menus"),
    initialData,
  });
}
