# Phase 4. 프론트엔드 기반 — 렌더링 전략 & Provider & 테마 & API 클라이언트

> **목표:** 프론트엔드 공용 인프라 구축 — 렌더링 전략 수립, Server/Client Component 경계 설정, 타입 정의, 서버/클라이언트 API 클라이언트, 테마 시스템, Provider 계층, 라우트 구조
>
> **예상 소요:** 90~120분
>
> **선행 조건:** Phase 3 완료 (백엔드 메뉴/주문 API가 동작하는 상태)

---

## 왜 이 단계가 필요한가?

프론트엔드 컴포넌트를 만들기 전에 **공용 인프라**가 먼저 갖춰져야 한다. React-Query 클라이언트가 없으면 API를 호출할 수 없고, 테마가 없으면 스타일링이 일관되지 않으며, CartProvider가 없으면 장바구니 상태를 공유할 수 없다.

하지만 그보다 먼저 **렌더링 전략**을 결정해야 한다. Next.js App Router에서는 모든 컴포넌트가 기본적으로 Server Component이고, `"use client"`를 붙여야만 Client Component가 된다. 어떤 페이지를 서버에서 렌더링하고, 어디서 클라이언트로 넘길지 — 이 경계를 먼저 정하지 않으면 나중에 구조를 뒤엎어야 한다.

이 프로젝트는 **토스플레이스 팀의 제품들을 시뮬레이션**한다. POS(직원용), 키오스크(고객 셀프 주문), 테이블오더(QR 기반 모바일 주문), 관리자 대시보드 — 같은 백엔드를 공유하되 UI가 다른 여러 화면을 만든다. 이 구조를 지탱하는 것이 이 단계의 Provider 계층과 라우트 설계다.

---

## 구현 TODO

### Step 4-0. 렌더링 전략 & Server/Client Component 가이드라인

코드를 쓰기 전에 이해해야 할 개념이다. 이 Step은 **가이드라인**이며, 실제 구현은 Step 4-1부터 시작한다.

#### Next.js App Router의 렌더링 방식

Next.js App Router에서 가능한 렌더링 전략:

| 전략                         | 언제 렌더링             | 적합한 경우                        | Next.js 구현                               |
| ---------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------ |
| **SSG** (Static)             | 빌드 시                 | 변경 없는 페이지 (about, 이용약관) | 기본값 (동적 함수 미사용 시)               |
| **ISR** (Incremental Static) | 빌드 시 + 주기적 재생성 | 자주 안 바뀌는 데이터 (메뉴)       | `fetch(..., { next: { revalidate: 60 } })` |
| **SSR** (Server-side)        | 매 요청마다             | 요청별 다른 데이터 (테이블 번호)   | `fetch(..., { cache: 'no-store' })`        |
| **CSR** (Client-side)        | 브라우저에서            | 인터랙션 중심 (장바구니, 결제)     | `"use client"` + useQuery                  |

**이 프로젝트에서의 적용:**

| 페이지             | 렌더링                | 이유                                                  |
| ------------------ | --------------------- | ----------------------------------------------------- |
| `/` (POS 메인)     | **SSR + CSR**         | 서버에서 메뉴 prefetch → 클라이언트에서 장바구니/결제 |
| `/kiosk`           | **SSR + CSR**         | 서버에서 메뉴 fetch → 고객 셀프 주문 인터랙션         |
| `/order/[tableId]` | **Dynamic SSR + CSR** | 테이블 ID 기반 동적 렌더 + 모바일 주문                |
| `/admin`           | **SSR + CSR**         | 서버에서 초기 주문 fetch → 실시간 폴링                |
| `/payment/success` | **CSR**               | URL params 파싱 + confirm mutation                    |
| `/payment/fail`    | **CSR**               | 에러 메시지 표시 + 재시도                             |

#### Server Component vs Client Component 경계

**원칙: "가능한 한 서버에서, 필요한 만큼만 클라이언트에서"**

```
Server Components (기본값 — "use client" 안 붙이면 서버):
├── app/layout.tsx               → metadata, <html>, <body>
├── app/(pos)/page.tsx           → fetch menus on server, pass to client
├── app/kiosk/page.tsx           → fetch menus on server
├── app/order/[tableId]/page.tsx → fetch table+menu info
├── app/admin/page.tsx           → fetch initial orders
├── app/loading.tsx              → 로딩 UI (Suspense fallback)
├── app/error.tsx                → 에러 UI
└── app/not-found.tsx            → 404 UI

Client Components ("use client" 필요):
├── providers/*                  → QueryProvider, ThemeProvider, CartProvider
├── components/pos/*             → POSClientShell, MenuGrid, Cart (인터랙션)
├── components/kiosk/*           → KioskShell (고객용 UI)
├── components/common/*          → Button, ThemeToggle, Modal, CategoryTabs
└── app/payment/*/page.tsx       → 결제 상태 머신, URL params
```

**왜 이 경계인가?**

```
Server Component page.tsx에서:
  1. 서버에서 메뉴 데이터를 fetch (API 호출이 서버→서버이므로 빠름)
  2. 데이터를 props로 Client Component에 전달

Client Component Shell에서:
  3. 전달받은 데이터로 즉시 렌더링 (네트워크 대기 없음)
  4. React-Query로 이후 리페치/폴링 처리
  5. 장바구니, 결제 등 인터랙션 처리
```

이 패턴을 **"Server Page → Client Shell"** 패턴이라고 부른다:

```tsx
// app/(pos)/page.tsx — Server Component
async function POSPage() {
  const menus = await fetchMenusOnServer(); // 서버에서 fetch
  return <POSClientShell initialMenus={menus} />; // 클라이언트에 전달
}

// components/pos/POSClientShell.tsx — Client Component ("use client")
function POSClientShell({ initialMenus }: { initialMenus: MenuItem[] }) {
  // initialMenus로 즉시 렌더링, 이후 React-Query로 리페치
}
```

**장점:**

- 초기 로딩 시 서버에서 데이터를 가져오므로 **FCP(First Contentful Paint)가 빠름**
- 클라이언트 JavaScript 번들에 서버 전용 코드가 포함되지 않음
- 서버→서버 fetch는 클라이언트→서버보다 지연시간이 짧음

#### 토스플레이스 제품 시뮬레이션

이 프로젝트에서 만드는 각 페이지가 토스플레이스의 어떤 제품에 대응하는지:

| 토스플레이스 제품               | 시뮬레이션                                                   | 페이지             |
| ------------------------------- | ------------------------------------------------------------ | ------------------ |
| **POS** (주문/결제 컨트롤 타워) | 직원용 주문/결제 화면, 매장/포장 선택, 카테고리 탭, 즐겨찾기 | `/`                |
| **키오스크**                    | 고객 셀프 주문 화면, 큰 메뉴 카드, 간소화 플로우             | `/kiosk`           |
| **테이블오더**                  | QR 기반 모바일 주문 (테이블 번호 포함)                       | `/order/[tableId]` |
| **프랜차이즈 대시보드**         | 주문 목록 + 상태 필터 + 매출 요약                            | `/admin`           |
| **KDS (주문현황)**              | 실시간 주문 보드 (접수→준비중→완료)                          | `/admin/orders`    |

같은 메뉴 데이터, 같은 주문 API를 공유하되 **UI와 사용 맥락이 다르다**. 이것이 "컴포넌트 기반 아키텍처"가 빛나는 지점이다.

---

### Step 4-1. 공통 타입 정의

프론트엔드에서 사용할 타입들을 정의한다. 백엔드 API 응답 형태와 맞춰야 한다.

**파일:** `frontend/src/types/menu.ts`

```typescript
export interface MenuItem {
  id: string;
  name: string;
  price: number; // 원 단위 (Int)
  category: string;
  imageUrl: string | null;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**왜 타입을 별도 파일로 분리하나?**

- 여러 컴포넌트에서 같은 타입을 쓴다 (MenuGrid, Cart, OrderSummary 등)
- 한 곳에서 정의하면 백엔드 응답이 바뀔 때 한 군데만 수정하면 됨
- IDE의 자동완성이 동작해서 개발 속도가 빨라짐

**파일:** `frontend/src/types/order.ts`

```typescript
/** 주문 모드 — 매장 식사 / 포장 */
export type OrderMode = "DINE_IN" | "TAKE_OUT";

export interface OrderItemCreate {
  menu_id: string;
  quantity: number;
}

export interface OrderCreateRequest {
  items: OrderItemCreate[];
  idempotency_key: string;
  order_mode?: OrderMode; // 매장/포장 (기본값: DINE_IN)
}

export interface OrderItemResponse {
  id: string;
  quantity: number;
  price: number;
  menuId: string;
  menu: {
    id: string;
    name: string;
    price: number;
    category: string;
  };
}

export interface OrderResponse {
  id: string;
  orderNumber: number;
  status: string;
  totalAmount: number;
  idempotencyKey: string;
  items: OrderItemResponse[];
  payment: PaymentResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentResponse {
  id: string;
  paymentKey: string | null;
  status: string;
  amount: number;
  method: string | null;
  approvedAt: string | null;
}
```

**`OrderMode` 타입이 추가된 이유:**

토스 POS에서는 매장 식사와 포장 주문을 구분한다. 실제 매장에서 직원이 주문을 받을 때 "매장이세요? 포장이세요?"를 물어보고, 이 정보가 주문에 포함된다. 키오스크와 테이블오더에서도 이 구분이 필요하다.

```
POS 화면:  [매장] [포장] ← OrderMode 토글
키오스크:   [매장에서 드실게요] [가져갈게요]
테이블오더: 기본값 DINE_IN (테이블에서 주문하니까)
```

> 현재 백엔드 Order 모델에 `orderMode` 필드가 없다. 프론트엔드에서 먼저 타입을 정의하고, 필요시 백엔드에 필드를 추가하면 된다. 지금은 프론트엔드 UI용으로만 사용한다.

**`OrderItemResponse`의 타입이 백엔드 Pydantic 스키마와 다른 이유:**

- 백엔드 `OrderResponse`의 `items`는 `list[dict]`로 정의되어 있다
- 실제 반환되는 JSON은 Prisma의 `include` 쿼리 결과 그대로다 (camelCase)
- 프론트엔드에서는 이 실제 응답 형태에 맞춰 타입을 정의한다

**파일:** `frontend/src/types/api.ts`

```typescript
export interface ApiError {
  detail: string;
  status: number;
}
```

**파일:** `frontend/src/types/kiosk.ts`

```typescript
/** 키오스크/테이블오더 관련 타입 */

/** 키오스크 주문 단계 */
export type KioskStep = "MENU_SELECT" | "CART_REVIEW" | "ORDER_CONFIRM";
// "MENU_SELECT" : 메뉴 선택 단계
// "CART_REVIEW" : 장바구니 확인 단계
// "ORDER_CONFIRM" : 주문 확인 단계

/** 테이블 정보 */
export interface TableInfo {
  tableId: string;
  tableName: string; // "테이블 1", "테이블 2" 등
  capacity?: number;
}
```

> `payment.ts` 타입 (PaymentState, PaymentEvent, paymentReducer)은 Phase 9에서 구현한다. 이 단계에서는 주문/메뉴 관련 타입만 정의한다.

---

### Step 4-2. API 클라이언트 — 클라이언트용 + 서버용

Server Component에서의 fetch와 Client Component에서의 fetch는 다르게 다뤄야 한다.

> **학습 참고:** 인터셉터 개념이 생소하다면 → `docs/study/middleware-interceptor-guide.md`
> **변경 이력:** 이전 버전과의 차이점 → `docs/study/api-client-refactor.md`

#### 4-2-1. 클라이언트용 API 클라이언트

**파일:** `frontend/src/services/api.ts`

Client Component에서 React-Query를 통해 호출하는 API 클라이언트. 브라우저에서 실행된다.
**인터셉터 패턴**을 적용해 에러 처리, 로깅, 헤더 첨부를 중앙화한다.

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── 인터셉터 타입 정의 ─────────────────────────────────────

/** 요청 설정 객체 — 인터셉터가 가공하는 대상 */
interface RequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** API 에러 — 모든 에러를 이 형태로 정규화 */
export interface ApiError {
  detail: string;
  status: number;
}

/** 요청 인터셉터: 요청이 나가기 전에 config를 가공 */
type RequestInterceptor = (config: RequestConfig) => RequestConfig;

/** 응답 인터셉터: 응답이 돌아온 후 가공 (에러 처리 포함) */
type ResponseInterceptor = (response: Response, config: RequestConfig) => Response | Promise<Response>;

// ─── ApiClient 클래스 ─────────────────────────────────────

class ApiClient {
  private baseUrl: string;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** 요청 인터셉터 등록 */
  addRequestInterceptor(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor);
  }

  /** 응답 인터셉터 등록 */
  addResponseInterceptor(interceptor: ResponseInterceptor) {
    this.responseInterceptors.push(interceptor);
  }

  // ─── 핵심: 모든 요청이 통과하는 단일 메서드 ───

  private async request<T>(config: RequestConfig): Promise<T> {
    // 1) 요청 인터셉터 실행 (순서대로)
    let processedConfig = config;
    for (const interceptor of this.requestInterceptors) {
      processedConfig = interceptor(processedConfig);
    }

    // 2) 실제 fetch 실행
    let response = await fetch(processedConfig.url, {
      method: processedConfig.method,
      headers: processedConfig.headers,
      body: processedConfig.body,
    });

    // 3) 응답 인터셉터 실행 (순서대로)
    for (const interceptor of this.responseInterceptors) {
      response = await interceptor(response, processedConfig);
    }

    return response.json();
  }

  // ─── 공개 메서드: get / post / patch ───

  async get<T>(
    path: string,
    options?: { params?: Record<string, string | undefined> },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.set(key, value);
      });
    }

    return this.request<T>({
      url: url.toString(),
      method: "GET",
      headers: {},
    });
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>({
      url: `${this.baseUrl}${path}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>({
      url: `${this.baseUrl}${path}`,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

// ─── 인터셉터 정의 ─────────────────────────────────────

/** 에러 정규화 인터셉터: res.ok가 아니면 ApiError로 throw */
const errorInterceptor: ResponseInterceptor = async (response, config) => {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw {
      detail: body.detail || response.statusText,
      status: response.status,
    } as ApiError;
  }
  return response;
};

/** 로깅 인터셉터 (개발 환경 전용): API 호출 추적 */
const loggingRequestInterceptor: RequestInterceptor = (config) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`[API] → ${config.method} ${config.url}`);
  }
  return config;
};

const loggingResponseInterceptor: ResponseInterceptor = (response, config) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`[API] ← ${response.status} ${config.method} ${config.url}`);
  }
  return response;
};

// ─── 인스턴스 생성 & 인터셉터 등록 ─────────────────────

const api = new ApiClient(BASE_URL);

// 순서 중요: 로깅 → fetch → 에러 체크 → 로깅
api.addRequestInterceptor(loggingRequestInterceptor);
api.addResponseInterceptor(errorInterceptor);          // 에러를 먼저 체크
api.addResponseInterceptor(loggingResponseInterceptor); // 로깅은 마지막

export { api };
```

**인터셉터 실행 흐름:**

```
api.post("/api/orders", { items: [...] })
  │
  ▼
[요청 인터셉터: 로깅]  →  "[API] → POST /api/orders"  콘솔 출력
  │
  ▼
fetch() 실행  →  백엔드 서버 호출
  │
  ▼
[응답 인터셉터: 에러]  →  res.ok 아니면 ApiError throw
  │                      res.ok면 통과
  ▼
[응답 인터셉터: 로깅]  →  "[API] ← 201 POST /api/orders"  콘솔 출력
  │
  ▼
response.json() → 호출 코드에 반환
```

> **Phase 8 미리보기:** 멱등성 키가 필요할 때, 인터셉터 하나만 추가하면 된다:
> ```typescript
> // Phase 8에서 추가할 멱등성 인터셉터 (지금은 작성하지 않음)
> const idempotencyInterceptor: RequestInterceptor = (config) => {
>   if (config.method === "POST" || config.method === "PATCH") {
>     config.headers["Idempotency-Key"] = generateIdempotencyKey();
>   }
>   return config;
> };
> api.addRequestInterceptor(idempotencyInterceptor);
> ```

#### 4-2-2. 서버용 API 클라이언트

**파일:** `frontend/src/lib/server-api.ts`

Server Component에서 호출하는 API 클라이언트. **서버에서만 실행**된다. Next.js의 확장된 `fetch`를 사용해서 캐싱/ISR을 활용한다.

서버용은 인터셉터 클래스 대신 **함수 래퍼** 방식을 쓴다. 이유:
- 서버 컴포넌트에서는 인스턴스 상태를 유지할 필요가 없다 (요청마다 독립)
- Next.js `fetch` 확장 옵션(`next: { revalidate }`)을 그대로 전달해야 한다
- 호출 지점이 적다 (page.tsx에서 3~4개 함수만 호출)

```typescript
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
```

**왜 API 클라이언트가 두 개인가?**

```
클라이언트용 (services/api.ts):
  브라우저 → 백엔드 서버
  - NEXT_PUBLIC_API_URL 사용 (공개 URL)
  - React-Query가 캐싱/재시도 관리
  - "use client" 컴포넌트에서 사용
  - 인터셉터 체인: 로깅 → fetch → 에러 → 로깅

서버용 (lib/server-api.ts):
  Next.js 서버 → 백엔드 서버
  - INTERNAL_API_URL 사용 (내부 네트워크, 더 빠름)
  - Next.js fetch 확장으로 ISR/캐싱
  - Server Component page.tsx에서 사용
  - 함수 래퍼: serverFetch()가 에러 + 로깅 일괄 처리
```

**왜 클라이언트는 인터셉터 클래스, 서버는 함수 래퍼인가?**

```
클라이언트 (services/api.ts):
  ┌──────────────────────────────────────────────┐
  │  호출 지점이 많다 (10개+ 훅에서 사용)          │
  │  Phase 8에서 멱등성 인터셉터 추가 예정         │
  │  향후 인증 인터셉터 추가 가능성               │
  │  → 인터셉터를 자유롭게 추가/제거할 수 있어야 함  │
  │  → 클래스 + 인터셉터 체인 패턴                │
  └──────────────────────────────────────────────┘

서버 (lib/server-api.ts):
  ┌──────────────────────────────────────────────┐
  │  호출 지점이 적다 (3~4개 함수)                 │
  │  인터셉터 추가 계획 없음                      │
  │  Next.js fetch 확장을 그대로 써야 함           │
  │  → 단순한 함수 래퍼로 충분                    │
  └──────────────────────────────────────────────┘
```

**`revalidate: 60`의 의미 (ISR):**

```
1. 첫 요청 → 서버에서 메뉴 fetch → 페이지 생성 → CDN에 캐시
2. 60초 이내 요청 → CDN 캐시에서 즉시 반환 (서버 호출 없음)
3. 60초 후 요청 → CDN 캐시 반환 + 백그라운드에서 재생성
4. 다음 요청 → 새로 생성된 페이지 반환
```

메뉴는 자주 바뀌지 않으므로 60초 ISR이 적절하다. 주문 목록은 실시간성이 중요하므로 `cache: 'no-store'`(매 요청마다 fetch).

---

### Step 4-3. 테마 정의

Emotion의 `ThemeProvider`에 주입할 테마 객체를 정의한다. Toss 디자인에서 영감을 받은 색상 체계.

**파일:** `frontend/src/styles/theme.ts`

```typescript
export const lightTheme = {
  mode: "light" as const,
  colors: {
    background: "#FFFFFF",
    surface: "#F5F5F5",
    surfaceHover: "#EEEEEE",
    text: {
      primary: "#1A1A1A",
      secondary: "#666666",
      disabled: "#AAAAAA",
    },
    primary: "#3182F6", // Toss 블루
    primaryHover: "#1B64DA",
    danger: "#F04452",
    success: "#2BD67E",
    warning: "#FF9F00",
    border: "#E5E5E5",
    shadow: "rgba(0, 0, 0, 0.08)",
    // 카테고리 컬러 (토스 POS 스타일)
    category: {
      coffee: "#8B6544",
      beverage: "#3182F6",
      bakery: "#FF9F00",
      default: "#666666",
    },
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
  },
  borderRadius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
  },
  fontSize: {
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "20px",
    xl: "24px",
    xxl: "32px",
  },
};

export type AppTheme = Omit<typeof lightTheme, "mode"> & {
  mode: "light" | "dark";
};

export const darkTheme: AppTheme = {
  ...lightTheme,
  mode: "dark",
  colors: {
    ...lightTheme.colors,
    background: "#1A1A1A",
    surface: "#2A2A2A",
    surfaceHover: "#333333",
    text: {
      primary: "#F0F0F0",
      secondary: "#A0A0A0",
      disabled: "#666666",
    },
    border: "#3A3A3A",
    shadow: "rgba(0, 0, 0, 0.3)",
    category: {
      coffee: "#C4956A",
      beverage: "#5BA0F8",
      bakery: "#FFB84D",
      default: "#999999",
    },
  },
};
```

**카테고리 컬러가 추가된 이유:**

토스 POS에서 메뉴 카테고리마다 색상 코딩이 되어 있다. 커피는 브라운, 음료는 블루, 베이커리는 오렌지 — 직원이 빠르게 구분할 수 있게 시각적 단서를 제공한다.

```
[커피]       → #8B6544 (브라운)   → 아메리카노, 카페라떼, 바닐라라떼
[음료]       → #3182F6 (블루)     → 녹차라떼, 초코라떼, 딸기스무디
[베이커리]   → #FF9F00 (오렌지)   → 크로와상, 치즈케이크
```

**왜 `as const`를 쓰나?**

- `mode: "light" as const` → 타입이 `string`이 아닌 `"light"` 리터럴이 됨
- Emotion의 `theme.mode`를 쓸 때 `"light" | "dark"` 타입 체크가 가능

**왜 `AppTheme`을 `Omit<typeof lightTheme, "mode"> & { mode: "light" | "dark" }`로 정의하나?**

- `lightTheme.mode`가 `"light"` 리터럴 타입이므로 `typeof lightTheme`을 그대로 쓰면 `darkTheme.mode`에 `"dark"`를 할당할 수 없음
- `Omit`으로 `mode`를 제거하고 `"light" | "dark"` 유니온으로 재정의하면 두 테마 모두 사용 가능
- `darkTheme: AppTheme` → 두 테마의 구조가 동일함을 보장하면서 mode 값만 다를 수 있음

**파일:** `frontend/src/styles/styled.d.ts`

Emotion이 `theme` 객체의 타입을 알 수 있도록 모듈 선언을 확장한다.

```typescript
import "@emotion/react";
import type { AppTheme } from "./theme";

declare module "@emotion/react" {
  export interface Theme extends AppTheme {}
}
```

**왜 이 파일이 필요한가?**

- 이 선언이 없으면 `css` prop이나 `styled` 컴포넌트에서 `theme.colors.primary` 같은 접근 시 타입 에러가 발생한다
- TypeScript의 **declaration merging**을 이용해 Emotion의 기본 `Theme` 인터페이스에 우리 타입을 합친다

```
// 이 선언이 없으면:
const Button = styled.button`
  color: ${({ theme }) => theme.colors.primary};
                                  ↑ Property 'colors' does not exist on type 'Theme'

// 이 선언이 있으면:
  color: ${({ theme }) => theme.colors.primary};   // ✅ 자동완성 + 타입 체크
```

**파일:** `frontend/src/styles/global.ts`

브라우저 기본 스타일을 리셋하고 앱 전체에 적용할 베이스 스타일을 정의한다.

```typescript
import { css } from "@emotion/react";
import type { AppTheme } from "./theme";

export const globalStyles = (theme: AppTheme) => css`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
      Arial, sans-serif;
    background-color: ${theme.colors.background};
    color: ${theme.colors.text.primary};
    transition:
      background-color 0.2s,
      color 0.2s;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  button {
    cursor: pointer;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
  }

  /* POS/키오스크용 스크롤바 스타일 */
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-thumb {
    background: ${theme.colors.border};
    border-radius: 3px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
`;
```

**`transition`이 있는 이유:**

- 테마 전환(light ↔ dark) 시 배경색과 글자색이 부드럽게 변한다
- 없으면 즉시 바뀌어서 눈이 깜빡거리는 느낌이 든다

**스크롤바 스타일이 추가된 이유:**

- POS와 키오스크는 메뉴가 많으면 스크롤이 생긴다
- 기본 스크롤바는 넓고 눈에 띄어서 POS 화면에서 부자연스러움
- 얇고 둥근 스크롤바가 토스 디자인과 더 어울림

---

### Step 4-4. Provider 계층

Provider는 **바깥에서 안쪽** 순서로 감싸야 한다. 안쪽 Provider가 바깥쪽 Provider에 의존할 수 있기 때문이다.

```
<QueryProvider>               ← React-Query (모든 API 호출의 기반)
  <ThemeProvider>              ← Emotion 테마 (스타일링에 필요)
    <CartProvider>             ← 장바구니 상태 (테마 없이도 동작하지만, 순서 일관성)
      {children}               ← 페이지 컴포넌트
    </CartProvider>
  </ThemeProvider>
</QueryProvider>
```

#### 4-4-1. QueryProvider

**파일:** `frontend/src/providers/QueryProvider.tsx`

```typescript
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
```

**왜 `useState`로 `QueryClient`를 생성하나?**

```
// ❌ 나쁜 예 — 매 렌더마다 새 인스턴스 생성 → 캐시가 매번 날아감
const queryClient = new QueryClient();

// ✅ 좋은 예 — 컴포넌트 마운트 시 한 번만 생성, 이후 동일 인스턴스 재사용
const [queryClient] = useState(() => new QueryClient());
```

- `useState`의 초기화 함수는 **최초 렌더링 시 한 번만 실행**된다
- 이렇게 해야 React-Query 캐시가 페이지 이동 후에도 유지됨

**왜 `"use client"` 지시어가 필요한가?**

- Next.js App Router에서 컴포넌트는 기본적으로 **서버 컴포넌트**
- `useState`, `useContext` 같은 React 훅은 서버에서 실행 불가
- `"use client"` → 이 파일부터 아래는 클라이언트에서 렌더링됨

**`staleTime: 5_000`의 의미:**

```
1. useQuery로 메뉴 목록 fetch → 캐시에 저장
2. 5초 이내에 다시 같은 쿼리 → 캐시에서 즉시 반환 (네트워크 요청 없음)
3. 5초 후에 다시 같은 쿼리 → 캐시 반환 + 백그라운드에서 리페치
```

- POS 환경에서 5초는 적절한 균형 — 너무 자주 요청하면 서버 부담, 너무 늦으면 데이터가 오래됨

#### 4-4-2. ThemeProvider

**파일:** `frontend/src/providers/ThemeProvider.tsx`

```typescript
"use client";

import { ThemeProvider as EmotionThemeProvider, Global } from "@emotion/react";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { lightTheme, darkTheme, AppTheme } from "@/styles/theme";
import { globalStyles } from "@/styles/global";

type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  toggle: () => {},
});

const THEME_STORAGE_KEY = "toss_sync_pos_theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  // 초기 로드: localStorage 또는 시스템 설정 반영
  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (stored) {
      setMode(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setMode("dark");
    }
  }, []);

  const toggle = () => {
    setMode((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  const theme: AppTheme = mode === "light" ? lightTheme : darkTheme;

  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      <EmotionThemeProvider theme={theme}>
        <Global styles={globalStyles(theme)} />
        {children}
      </EmotionThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeContext);
}
```

**왜 `useEffect`에서 localStorage를 읽나?**

```
서버 렌더링 (SSR)           클라이언트 렌더링
─────────────────           ──────────────────
localStorage 없음            localStorage 있음
→ "light" 기본값 사용         → useEffect에서 저장된 테마 로드
```

- Next.js SSR 중에 `localStorage`에 접근하면 에러 (서버에는 localStorage가 없음)
- `useEffect`는 **클라이언트에서만** 실행되므로 안전
- 초기엔 light 테마로 렌더링 → `useEffect` 후 저장된 테마로 전환 (잠깐 깜빡일 수 있음)

**`window.matchMedia("(prefers-color-scheme: dark)")`의 역할:**

- 사용자의 **OS 설정**에 따라 다크 모드를 자동 감지
- 처음 방문한 사용자에게 OS 설정과 일치하는 테마를 보여줌
- 이미 localStorage에 저장된 값이 있으면 그것을 우선 사용

#### 4-4-3. CartProvider

**파일:** `frontend/src/providers/CartProvider.tsx`

```typescript
"use client";

import { createContext, useContext, useReducer, ReactNode } from "react";
import { MenuItem } from "@/types/menu";
import type { OrderMode } from "@/types/order";

// ─── 타입 정의 ───

export interface CartItem {
  menu: MenuItem;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  totalAmount: number;
  orderMode: OrderMode;    // 매장/포장
}

type CartAction =
  | { type: "ADD_ITEM"; menu: MenuItem }
  | { type: "REMOVE_ITEM"; menuId: string }
  | { type: "UPDATE_QUANTITY"; menuId: string; quantity: number }
  | { type: "SET_ORDER_MODE"; mode: OrderMode }
  | { type: "CLEAR" };

// ─── Reducer ───

function calcTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.menu.price * i.quantity, 0);
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const existing = state.items.find((i) => i.menu.id === action.menu.id);
      const items = existing
        ? state.items.map((i) =>
            i.menu.id === action.menu.id
              ? { ...i, quantity: i.quantity + 1 }
              : i
          )
        : [...state.items, { menu: action.menu, quantity: 1 }];
      return { ...state, items, totalAmount: calcTotal(items) };
    }
    case "REMOVE_ITEM": {
      const items = state.items.filter((i) => i.menu.id !== action.menuId);
      return { ...state, items, totalAmount: calcTotal(items) };
    }
    case "UPDATE_QUANTITY": {
      if (action.quantity <= 0) {
        return cartReducer(state, {
          type: "REMOVE_ITEM",
          menuId: action.menuId,
        });
      }
      const items = state.items.map((i) =>
        i.menu.id === action.menuId ? { ...i, quantity: action.quantity } : i
      );
      return { ...state, items, totalAmount: calcTotal(items) };
    }
    case "SET_ORDER_MODE":
      return { ...state, orderMode: action.mode };
    case "CLEAR":
      return { ...state, items: [], totalAmount: 0 };
    default:
      return state;
  }
}

// ─── Context & Provider ───

const CartContext = createContext<{
  state: CartState;
  dispatch: React.Dispatch<CartAction>;
} | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items: [],
    totalAmount: 0,
    orderMode: "DINE_IN",
  });

  return (
    <CartContext.Provider value={{ state, dispatch }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
```

**기존 대비 변경사항:**

- `CartState`에 `orderMode: OrderMode` 추가
- `SET_ORDER_MODE` 액션 추가
- 초기값에 `orderMode: "DINE_IN"` 추가

**왜 `useReducer`를 쓰고 `useState`를 안 쓰나?**

```
// useState로 장바구니를 관리하면:
const [items, setItems] = useState([]);
const [totalAmount, setTotalAmount] = useState(0);
const [orderMode, setOrderMode] = useState("DINE_IN");

// 아이템 추가 시:
setItems(prev => [...prev, newItem]);      // items 업데이트
setTotalAmount(prev => prev + price);      // total 업데이트
// → 두 상태가 따로 업데이트되어 잠깐 불일치 가능

// useReducer로 관리하면:
dispatch({ type: "ADD_ITEM", menu });
// → items와 totalAmount가 한 번에 업데이트
```

- `useReducer`는 **여러 상태를 하나의 액션으로 동시에 업데이트**할 때 적합
- 장바구니는 `items`, `totalAmount`, `orderMode`가 항상 동기화되어야 하므로 reducer가 더 안전

#### 4-4-4. AppProviders (합성)

**파일:** `frontend/src/providers/AppProviders.tsx`

```typescript
"use client";

import { QueryProvider } from "./QueryProvider";
import { ThemeProvider } from "./ThemeProvider";
import { CartProvider } from "./CartProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <CartProvider>{children}</CartProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
```

**왜 합성 컴포넌트를 별도로 만드나?**

- `layout.tsx`에서 Provider를 3중으로 중첩하면 들여쓰기가 깊어지고 가독성이 떨어짐
- Provider 추가/제거/순서 변경이 이 파일 하나에서 해결됨

---

### Step 4-5. 라우트 구조 & 레이아웃

#### 4-5-1. 루트 레이아웃

**파일:** `frontend/src/app/layout.tsx`

기존 create-next-app 보일러플레이트를 제거하고 `AppProviders`로 감싼다.

```tsx
import type { Metadata } from "next";
import { AppProviders } from "@/providers/AppProviders";

export const metadata: Metadata = {
  title: "Toss-Sync POS",
  description: "소규모 매장을 위한 실시간 결제 처리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
```

**기존 `layout.tsx`에서 바뀌는 것:**

- `import "./globals.css"` 제거 — Emotion `<Global>` 컴포넌트가 대체
- `<AppProviders>`로 `{children}` 감싸기
- metadata 한글화

**`layout.tsx` 자체는 서버 컴포넌트인데 `AppProviders`(클라이언트)를 쓸 수 있는 이유:**

```
layout.tsx (서버 컴포넌트)
  └── AppProviders (클라이언트 컴포넌트 — "use client")
        └── {children} (서버/클라이언트 혼합 가능)
```

- 서버 컴포넌트는 클라이언트 컴포넌트를 **자식으로 포함**할 수 있다
- 반대로 클라이언트 컴포넌트 안에서 서버 컴포넌트를 import하면 안 됨
- `{children}`은 서버에서 렌더링된 결과를 전달받는 **슬롯**이므로 괜찮음

#### 4-5-2. 페이지 구조 설계

```
frontend/src/app/
├── layout.tsx                    → 루트 레이아웃 (서버) — AppProviders
├── loading.tsx                   → 전역 로딩 UI (서버)
├── error.tsx                     → 전역 에러 UI (클라이언트)
├── not-found.tsx                 → 404 UI (서버)
│
├── (pos)/                        → Route Group — POS 레이아웃
│   ├── layout.tsx                → POS 전용 레이아웃 (선택)
│   └── page.tsx                  → POS 메인 (서버 → POSClientShell)
│
├── kiosk/
│   └── page.tsx                  → 키오스크 (서버 → KioskShell)
│
├── order/
│   └── [tableId]/
│       └── page.tsx              → 테이블오더 (서버 → TableOrderShell)
│
├── admin/
│   ├── page.tsx                  → 관리자 대시보드 (서버 → AdminShell)
│   └── orders/
│       └── page.tsx              → KDS 주문현황 (서버 → KDSShell)
│
└── payment/
    ├── success/
    │   └── page.tsx              → 결제 성공 (클라이언트)
    └── fail/
        └── page.tsx              → 결제 실패 (클라이언트)
```

**Route Group `(pos)`란?**

```
app/(pos)/page.tsx  → URL: /        (괄호 안의 이름은 URL에 포함 안 됨)
app/kiosk/page.tsx  → URL: /kiosk
app/admin/page.tsx  → URL: /admin
```

- `(pos)`는 URL에 영향을 주지 않는 폴더 그룹
- POS 전용 레이아웃을 분리하고 싶을 때 유용
- 키오스크나 관리자 페이지와 다른 레이아웃을 적용할 수 있음

**`[tableId]`란?**

```
/order/1    → tableId = "1"
/order/A3   → tableId = "A3"
```

- Next.js의 **동적 라우트 세그먼트**
- URL 경로의 일부를 변수로 받음
- 실제 매장에서는 테이블에 QR코드를 붙여놓고, 스캔하면 `/order/1` 같은 URL로 이동

#### 4-5-3. 로딩/에러/404 페이지

**파일:** `frontend/src/app/loading.tsx`

```tsx
export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        fontSize: "16px",
        color: "#666",
      }}
    >
      로딩 중...
    </div>
  );
}
```

**파일:** `frontend/src/app/error.tsx`

```tsx
"use client"; // error.tsx는 반드시 Client Component

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        gap: "16px",
      }}
    >
      <h2 style={{ fontSize: "20px", color: "#F04452" }}>
        문제가 발생했습니다
      </h2>
      <p style={{ color: "#666" }}>{error.message}</p>
      <button
        onClick={reset}
        style={{
          padding: "8px 16px",
          background: "#3182F6",
          color: "white",
          borderRadius: "8px",
          border: "none",
          cursor: "pointer",
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
```

**왜 `error.tsx`는 반드시 `"use client"`인가?**

- Next.js의 에러 바운더리는 React의 `ErrorBoundary`를 기반으로 함
- `ErrorBoundary`는 클래스 컴포넌트 (또는 클라이언트 컴포넌트) 전용
- `reset()` 함수를 통해 에러를 복구하려면 클라이언트 상태가 필요

**파일:** `frontend/src/app/not-found.tsx`

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        gap: "16px",
      }}
    >
      <h2 style={{ fontSize: "24px" }}>페이지를 찾을 수 없습니다</h2>
      <Link href="/" style={{ color: "#3182F6" }}>
        POS 화면으로 돌아가기
      </Link>
    </div>
  );
}
```

#### 4-5-4. 기존 보일러플레이트 정리

**삭제할 파일:**

- `frontend/src/app/globals.css` — Emotion Global로 대체
- `frontend/src/app/page.module.css` — Phase 5에서 Emotion styled로 대체

**수정할 파일:**

`frontend/src/app/(pos)/page.tsx` — 임시 확인용 (Phase 5에서 POS 메인 화면으로 교체):

```tsx
export default function POSPage() {
  return (
    <div style={{ padding: "32px" }}>
      <h1>Toss-Sync POS</h1>
      <p>Phase 4 완료 — Provider 계층 + 라우트 구조 정상 동작 확인</p>
      <nav style={{ marginTop: "16px", display: "flex", gap: "16px" }}>
        <a href="/kiosk" style={{ color: "#3182F6" }}>
          키오스크 →
        </a>
        <a href="/order/1" style={{ color: "#3182F6" }}>
          테이블오더 →
        </a>
        <a href="/admin" style={{ color: "#3182F6" }}>
          관리자 →
        </a>
      </nav>
    </div>
  );
}
```

> 이 페이지와 나머지 페이지들은 Phase 5에서 실제 UI로 교체된다.

---

### Step 4-6. 각 페이지별 렌더링 전략 구체화

Step 4-0에서 설명한 렌더링 전략을 **실제 코드 패턴**으로 정리한다. Phase 5에서 이 패턴대로 구현한다.

#### POS 메인 (`/`) — SSR + CSR

```tsx
// app/(pos)/page.tsx (Server Component)
import { getMenus } from "@/lib/server-api";
import { POSClientShell } from "@/components/pos/POSClientShell";

export default async function POSPage() {
  const menus = await getMenus(); // 서버에서 메뉴 fetch (ISR 60초)
  return <POSClientShell initialMenus={menus} />;
}
```

```tsx
// components/pos/POSClientShell.tsx (Client Component)
"use client";
export function POSClientShell({ initialMenus }: { initialMenus: MenuItem[] }) {
  // initialData로 React-Query에 주입 → 즉시 렌더링, 이후 리페치
  const { data: menus } = useQuery({
    queryKey: ["menus"],
    queryFn: () => api.get("/api/menus"),
    initialData: initialMenus,
  });
  // ... 장바구니, 결제 등 인터랙션
}
```

**왜 `initialData`를 쓰나?**

```
서버 fetch:  메뉴 8개 → props로 전달
  ↓
클라이언트:  initialData로 즉시 렌더링 (로딩 스피너 없음!)
  ↓
5초 후:     React-Query가 백그라운드 리페치 → 최신 데이터로 교체
```

- 서버에서 이미 가져온 데이터를 버리지 않고 재활용
- 사용자 입장에서는 페이지 로드 즉시 메뉴가 보임 (SSR의 장점)
- 이후에는 React-Query가 관리 (CSR의 장점)

#### 키오스크 (`/kiosk`) — SSR + CSR

POS와 동일한 패턴. 같은 메뉴 데이터를 서버에서 fetch하되, UI만 다름 (고객용 큰 카드).

```tsx
// app/kiosk/page.tsx (Server Component)
import { getMenus } from "@/lib/server-api";
import { KioskShell } from "@/components/kiosk/KioskShell";

export default async function KioskPage() {
  const menus = await getMenus();
  return <KioskShell initialMenus={menus} />;
}
```

#### 테이블오더 (`/order/[tableId]`) — Dynamic SSR + CSR

테이블 ID가 URL에 포함되므로 **항상 동적 SSR**.

```tsx
// app/order/[tableId]/page.tsx (Server Component)
import { getMenus } from "@/lib/server-api";
import { TableOrderShell } from "@/components/order/TableOrderShell";

export default async function TableOrderPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  const menus = await getMenus();
  return <TableOrderShell tableId={tableId} initialMenus={menus} />;
}
```

#### 관리자 (`/admin`) — SSR + CSR

```tsx
// app/admin/page.tsx (Server Component)
import { getOrders } from "@/lib/server-api";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function AdminPage() {
  const orders = await getOrders();
  return <AdminShell initialOrders={orders} />;
}
```

#### 결제 결과 (`/payment/*`) — CSR

Toss 결제 후 리다이렉트되는 페이지. URL 파라미터를 파싱하고 confirm API를 호출하므로 순수 CSR.

```tsx
// app/payment/success/page.tsx (Client Component)
"use client";
export default function PaymentSuccessPage() {
  // useSearchParams()로 paymentKey, orderId, amount 추출
  // confirmPayment mutation 호출
}
```

---

## 검증 체크리스트

- [ ] **빌드 확인**

  ```bash
  cd frontend && npm run build
  # → 에러 없이 빌드 성공
  ```

- [ ] **타입 체크**

  ```bash
  cd frontend && npx tsc --noEmit
  # → 타입 에러 없음
  ```

- [ ] **개발 서버 실행**

  ```bash
  cd frontend && npm run dev
  # http://localhost:3000 접속 → "Toss-Sync POS" 텍스트 표시, 콘솔 에러 없음
  ```

- [ ] **라우트 확인**
  - `http://localhost:3000/` → POS 임시 페이지
  - `http://localhost:3000/kiosk` → 키오스크 임시 페이지 (또는 404)
  - `http://localhost:3000/order/1` → 테이블오더 임시 페이지 (또는 404)
  - `http://localhost:3000/admin` → 관리자 임시 페이지 (또는 404)
  - `http://localhost:3000/nonexistent` → 404 페이지 표시

- [ ] **React-Query 동작 확인**
  - 브라우저 DevTools → Console에 React-Query 관련 에러 없음

- [ ] **테마 전환 확인**
  - 브라우저 DevTools → Console에서 직접 확인:
  ```javascript
  localStorage.setItem("toss_sync_pos_theme", "dark");
  location.reload();
  // → 배경이 어두운 색(#1A1A1A)으로 바뀌면 성공
  ```

---

## 다음 단계

→ **Phase 5**: POS 메인 화면 + 키오스크 + 테이블오더 구현. Provider 인프라와 라우트 구조가 갖춰졌으니, 토스 POS 스타일의 메뉴 그리드, 장바구니, 카테고리 탭을 만들고, 키오스크와 테이블오더 기본 구조를 추가한다.
