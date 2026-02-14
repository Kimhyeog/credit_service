/**
 * 서버 컴포넌트용 API 클라이언트
 * - Next.js 확장 fetch 사용 (캐싱, revalidation)
 * - 서버→서버 호출이므로 내부 네트워크 URL 사용 가능
 */

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

interface FetchOptions {
  revalidate?: number; // ISR: N초마다 재생성
  cache?: RequestCache; // 'no-store' = SSR (매 요청마다), 'force-cache' = SSG
  tags?: string[]; // On-demand revalidation용 태그
}

/**
 * 서버 fetch 래퍼 — 에러 처리 + 캐싱 옵션을 중앙화
 *
 * 클라이언트 ApiClient와의 차이:
 * - 인터셉터 체인 없음 (호출 지점이 적어 불필요)
 * - 대신 이 함수 자체가 "에러 처리 + 캐싱"을 담당하는 단일 래퍼
 */
async function serverFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { revalidate, cache, tags } = options;

  const fetchOptions: RequestInit & {
    next?: { revalidate?: number; tags?: string[] };
  } = {};

  if (cache) {
    fetchOptions.cache = cache;
  } else if (revalidate !== undefined) {
    fetchOptions.next = { revalidate, tags };
  }

  const url = `${INTERNAL_API_URL}${path}`;

  // 개발 환경 로깅
  if (process.env.NODE_ENV === "development") {
    console.log(`[Server API] → GET ${path}`);
  }

  const res = await fetch(url, fetchOptions);

  if (!res.ok) {
    // 서버 API 에러 — page.tsx의 try/catch에서 처리
    throw new Error(`Server API error: ${res.status} ${res.statusText} (${path})`);
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[Server API] ← ${res.status} ${path}`);
  }

  return res.json();
}

/** 메뉴 목록 — 60초 ISR (메뉴는 자주 안 바뀜) */
export async function getMenus() {
  return serverFetch<import("@/types/menu").MenuItem[]>("/api/menus", {
    revalidate: 60,
    tags: ["menus"],
  });
}

/** 주문 목록 — SSR (매 요청마다 최신 데이터) */
export async function getOrders(status?: string) {
  const path = status ? `/api/orders?status=${status}` : "/api/orders";
  return serverFetch<import("@/types/order").OrderResponse[]>(path, {
    cache: "no-store",
  });
}

/** 주문 상세 — SSR */
export async function getOrder(orderId: string) {
  return serverFetch<import("@/types/order").OrderResponse>(
    `/api/orders/${orderId}`,
    {
      cache: "no-store",
    },
  );
}
