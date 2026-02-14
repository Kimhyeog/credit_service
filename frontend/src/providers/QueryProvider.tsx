"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,              // 5초 — 데이터를 '신선'하다고 간주하는 시간
            gcTime: 10 * 60_000,           // 10분 — 사용하지 않는 캐시 유지 시간
            retry: 2,                      // 실패 시 2회 재시도
            refetchOnWindowFocus: true,    // 탭 전환 시 자동 리페치
          },
          mutations: {
            retry: 1,                      // mutation은 1회 재시도
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
