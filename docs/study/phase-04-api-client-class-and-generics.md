# ApiClient 클래스 & 제네릭 학습 가이드

> Next.js에서 왜 클래스를 사용하는지, 그리고 `get<T>`, `post<T>`의 `<T>`가 무엇이고 왜 필요한지를 정리한다.

---

## Part 1. 왜 클래스로 묶었는가

### 클래스를 안 썼다면 — 함수만으로 구현

```typescript
// services/api.ts — 함수만 사용

const BASE_URL = "http://localhost:8000";

export async function get(path: string) {
  console.log(`[API] → GET ${path}`);
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown" }));
    throw { detail: err.detail, status: res.status };
  }
  console.log(`[API] ← ${res.status} ${path}`);
  return res.json();
}

export async function post(path: string, body?: unknown) {
  console.log(`[API] → POST ${path}`);                    // 복사
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown" }));
    throw { detail: err.detail, status: res.status };      // 복사
  }
  console.log(`[API] ← ${res.status} ${path}`);            // 복사
  return res.json();
}

export async function patch(path: string, body?: unknown) {
  console.log(`[API] → PATCH ${path}`);                    // 또 복사
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown" }));
    throw { detail: err.detail, status: res.status };      // 또 복사
  }
  console.log(`[API] ← ${res.status} ${path}`);            // 또 복사
  return res.json();
}
```

**문제: 공통 기능을 추가하려면 함수마다 수정해야 한다:**

```
Phase 8에서 멱등성 키 추가:
  get()   → 수정 (GET은 안 붙여야 하니까 조건문 추가)
  post()  → 수정
  patch() → 수정
  (미래) put() → 수정
  (미래) delete() → 수정

  기능 1개 추가 = 함수 N개 수정
```

### 클래스가 해결하는 것 — `request()` 단일 통로

```
함수 버전:
  get()   ──→ fetch()     각자 독립적으로 fetch 호출
  post()  ──→ fetch()     공통 로직이 필요하면 전부 수정
  patch() ──→ fetch()

클래스 버전:
  get()   ──┐
  post()  ──┼──→ request() ──→ [인터셉터들] ──→ fetch()
  patch() ──┘    ↑ 모든 요청이 여기를 통과
                   공통 로직은 여기에 한 번만
```

Phase 8에서 멱등성 키 추가할 때:

```typescript
// 클래스 버전 — 인터셉터 1줄 추가로 끝
api.addRequestInterceptor((config) => {
  if (config.method === "POST" || config.method === "PATCH") {
    config.headers["Idempotency-Key"] = generateKey();
  }
  return config;
});
// get, post, patch 코드는 한 글자도 안 바뀜!
```

### 클래스가 해주는 3가지

**1) 상태 보관 — 인터셉터 목록을 기억한다:**

```typescript
class ApiClient {
  private requestInterceptors: RequestInterceptor[] = [];   // ← 상태
  private responseInterceptors: ResponseInterceptor[] = []; // ← 상태
  private baseUrl: string;                                   // ← 상태
}

// 함수 버전은 모듈 전역 변수를 써야 함
let interceptors: Function[] = [];  // ← 모듈 전역에 노출 (지저분)
```

**2) `private request()` — 외부에서 직접 호출 불가:**

```
외부에서 보이는 것:       내부 구조:

api.get(...)              get() ──┐
api.post(...)             post() ──┼──→ request() ──→ fetch
api.patch(...)            patch()──┘
                                       ↑ 숨겨져 있음 (private)
```

**3) 인스턴스 분리 — 여러 개 만들 수 있다:**

```typescript
const api = new ApiClient("http://localhost:8000");         // 우리 백엔드
const externalApi = new ApiClient("https://other-api.com"); // 외부 서비스
// 각각 독립적인 baseUrl, 독립적인 인터셉터
```

### React/Next.js에서 클래스 쓰는 곳 vs 안 쓰는 곳

```
클래스를 쓰는 곳 (서비스/유틸리티):
  ├── services/api.ts           ← ApiClient
  ├── services/payment/         ← TossPaymentStrategy (Phase 7)
  └── services/recovery/        ← WALManager (Phase 9)

클래스를 안 쓰는 곳 (UI):
  ├── components/*.tsx          ← 함수형 컴포넌트
  ├── hooks/*.ts                ← 커스텀 훅 (함수)
  └── app/**/page.tsx           ← 페이지 (함수)

규칙: React 컴포넌트 = 함수, 서비스/유틸리티 = 상태+메서드 필요하면 클래스
```

---

## Part 2. 왜 `<T>` 제네릭이 각 메서드에 있는가

### 제네릭이 없다면 어떻게 되는가

```typescript
// 제네릭 없는 버전
class ApiClient {
  async get(path: string): Promise<any> {    // ← 반환 타입이 any
    const res = await fetch(...);
    return res.json();                        // ← 뭐가 올지 모름
  }

  async post(path: string, body?: unknown): Promise<any> {
    const res = await fetch(...);
    return res.json();                        // ← 뭐가 올지 모름
  }
}
```

사용하는 쪽에서 타입을 모른다:

```typescript
const menus = await api.get("/api/menus");
// menus의 타입: any
// ↓
menus.forEach((m) => {
  console.log(m.name);   // ← 자동완성 안 됨
  console.log(m.nme);    // ← 오타인데 에러 안 남!
  console.log(m.price);  // ← number인지 string인지 모름
});
```

```
any 타입의 문제:

  api.get("/api/menus")
    │
    ▼
  menus: any    ← TypeScript가 포기. 아무 속성이나 접근 가능.
    │
    ├── menus[0].name     ✅ 동작 (있는 속성)
    ├── menus[0].nme      ✅ 동작 (오타인데 에러 안 남!)
    ├── menus[0].foo      ✅ 동작 (없는 속성인데 에러 안 남!)
    └── menus[0].price.toUpperCase()  ✅ 컴파일됨 (런타임에 크래시!)
                          ↑ number에 toUpperCase()는 없지만
                            any라서 체크 안 함
```

### 제네릭이 있으면

```typescript
// 제네릭 있는 버전
class ApiClient {
  async get<T>(path: string): Promise<T> {    // ← T는 "호출할 때 정해줄게"
    const res = await fetch(...);
    return res.json();
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(...);
    return res.json();
  }
}
```

사용하는 쪽에서 타입을 지정한다:

```typescript
// T = MenuItem[] 로 지정
const menus = await api.get<MenuItem[]>("/api/menus");
//                        ↑ "이 API는 MenuItem 배열을 반환해"

menus.forEach((m) => {
  console.log(m.name);    // ✅ 자동완성 됨 (name: string)
  console.log(m.nme);     // ❌ 컴파일 에러! 'nme' 속성이 없음
  console.log(m.price);   // ✅ 자동완성 됨 (price: number)
  m.price.toUpperCase();  // ❌ 컴파일 에러! number에 toUpperCase 없음
});
```

```
제네릭 타입의 효과:

  api.get<MenuItem[]>("/api/menus")
    │
    ▼
  menus: MenuItem[]    ← TypeScript가 정확히 알고 있음
    │
    ├── menus[0].name     ✅ (string)
    ├── menus[0].nme      ❌ 컴파일 에러! (오타 잡아줌)
    ├── menus[0].foo      ❌ 컴파일 에러! (없는 속성)
    └── menus[0].price.toUpperCase()  ❌ 컴파일 에러! (타입 불일치)
```

### `<T>`는 무엇인가 — 한 문장으로

**"지금은 타입을 비워두고, 호출할 때 채워넣는 빈칸"**

```typescript
// 정의할 때: T는 빈칸
async get<T>(path: string): Promise<T> { ... }
//       ↑ "반환 타입은 나중에 알려줄게"

// 호출할 때: T에 실제 타입을 넣음
api.get<MenuItem[]>("/api/menus");
//      ↑ T = MenuItem[]  →  반환 타입 = Promise<MenuItem[]>

api.get<OrderResponse[]>("/api/orders");
//      ↑ T = OrderResponse[]  →  반환 타입 = Promise<OrderResponse[]>

api.post<OrderResponse>("/api/orders", data);
//       ↑ T = OrderResponse  →  반환 타입 = Promise<OrderResponse>
```

---

### 이 프로젝트의 실제 사용 사례 5가지

#### 사례 1: 메뉴 목록 조회

```typescript
// hooks/useMenus.ts
import type { MenuItem } from "@/types/menu";

export function useMenus() {
  return useQuery({
    queryKey: ["menus"],
    queryFn: () => api.get<MenuItem[]>("/api/menus"),
    //                    ↑ T = MenuItem[]
  });
}

// 사용하는 컴포넌트에서:
const { data: menus } = useMenus();
// menus의 타입: MenuItem[] | undefined

menus?.map((menu) => (
  <div>{menu.name}</div>     // ✅ name: string 자동완성
  <div>{menu.price}원</div>  // ✅ price: number 자동완성
));
```

#### 사례 2: 주문 생성

```typescript
// hooks/useCreateOrder.ts
import type { OrderResponse, OrderCreateRequest } from "@/types/order";

export function useCreateOrder() {
  return useMutation({
    mutationFn: (data: OrderCreateRequest) =>
      api.post<OrderResponse>("/api/orders", data),
      //       ↑ T = OrderResponse
  });
}

// 사용하는 컴포넌트에서:
const { mutate, data } = useCreateOrder();
// data의 타입: OrderResponse | undefined

mutate({ items: [...], idempotency_key: "..." });
// 성공 후:
console.log(data?.id);           // ✅ string
console.log(data?.orderNumber);  // ✅ number
console.log(data?.status);       // ✅ string
```

#### 사례 3: 주문 목록 조회 (필터)

```typescript
// hooks/useOrders.ts
import type { OrderResponse } from "@/types/order";

export function useOrders(status?: string) {
  return useQuery({
    queryKey: ["orders", status],
    queryFn: () => api.get<OrderResponse[]>("/api/orders", {
      //                  ↑ T = OrderResponse[]
      params: { status },
    }),
  });
}
```

#### 사례 4: 주문 취소

```typescript
// hooks/useCancelOrder.ts
import type { OrderResponse } from "@/types/order";

export function useCancelOrder() {
  return useMutation({
    mutationFn: (orderId: string) =>
      api.patch<OrderResponse>(`/api/orders/${orderId}/cancel`),
      //        ↑ T = OrderResponse
  });
}
```

#### 사례 5: 결제 승인 (Phase 7)

```typescript
// hooks/useConfirmPayment.ts
import type { PaymentResponse, PaymentConfirmRequest } from "@/types/order";

export function useConfirmPayment() {
  return useMutation({
    mutationFn: (data: PaymentConfirmRequest) =>
      api.post<PaymentResponse>("/api/payments/confirm", data),
      //       ↑ T = PaymentResponse
  });
}

// 사용하는 컴포넌트에서:
const { data: payment } = useConfirmPayment();
// payment의 타입: PaymentResponse | undefined

console.log(payment?.paymentKey);  // ✅ string
console.log(payment?.method);      // ✅ string
console.log(payment?.approvedAt);  // ✅ string
```

---

### 제네릭이 request() 체인을 통과하는 과정

```typescript
// 호출:
api.get<MenuItem[]>("/api/menus")

// 1단계: get<T> 에서 T = MenuItem[]
async get<T>(path: string): Promise<T> {
  return this.request<T>({...});
  //                  ↑ T = MenuItem[] 을 request에 전달
}

// 2단계: request<T> 에서 T = MenuItem[]
private async request<T>(config: RequestConfig): Promise<T> {
  // 인터셉터 실행...
  let response = await fetch(...);
  // 인터셉터 실행...
  return response.json();   // ← 실제로는 any지만, Promise<T>로 선언했으니
  //                             TypeScript가 MenuItem[]로 취급
}

// 3단계: 호출한 쪽에서
const menus = await api.get<MenuItem[]>("/api/menus");
// menus: MenuItem[]  ← TypeScript가 확신함
```

```
T가 전달되는 흐름:

api.get<MenuItem[]>(...)
        │
        │  T = MenuItem[]
        ▼
    get<T>()  →  return this.request<T>(...)
                              │
                              │  T = MenuItem[]
                              ▼
                         request<T>()  →  return response.json() as T
                                                                   │
                                                                   │  T = MenuItem[]
                                                                   ▼
                                                          결과: MenuItem[]
```

---

### 제네릭 vs any vs 타입 단언 — 비교

세 가지 방법으로 같은 코드를 쓸 수 있다:

```typescript
// 방법 1: any (❌ 최악)
async get(path: string): Promise<any> { ... }
const menus = await api.get("/api/menus");
// menus: any → 오타 못 잡음, 자동완성 없음

// 방법 2: 타입 단언 (△ 차선)
async get(path: string): Promise<unknown> { ... }
const menus = await api.get("/api/menus") as MenuItem[];
//                                        ↑ 매번 as로 캐스팅

// 방법 3: 제네릭 (✅ 최선)
async get<T>(path: string): Promise<T> { ... }
const menus = await api.get<MenuItem[]>("/api/menus");
//                         ↑ 타입이 반환 타입에 자동 연결
```

```
비교:

방법 1 (any):
  정의: get(): Promise<any>
  호출: api.get("/api/menus")
  결과: any → 타입 체크 포기                    ❌

방법 2 (as 캐스팅):
  정의: get(): Promise<unknown>
  호출: api.get("/api/menus") as MenuItem[]
  결과: MenuItem[] 이지만 매번 as 필요           △
        빠뜨리면 unknown이라 사용 불가

방법 3 (제네릭):
  정의: get<T>(): Promise<T>
  호출: api.get<MenuItem[]>("/api/menus")
  결과: MenuItem[] → 자연스럽게 타입 연결        ✅
        React-Query의 queryFn과도 자동 연동
```

---

### 제네릭과 React-Query의 시너지

제네릭의 진짜 가치는 **React-Query와 연결될 때** 드러난다:

```typescript
// api.get의 제네릭이 useQuery까지 전파된다

function useMenus() {
  return useQuery({
    queryKey: ["menus"],
    queryFn: () => api.get<MenuItem[]>("/api/menus"),
    //             ↑ 반환: Promise<MenuItem[]>
  });
  // useQuery가 추론:
  // data: MenuItem[] | undefined
  // error: ApiError | null
}

// 컴포넌트에서 사용할 때:
function MenuGrid() {
  const { data: menus, isLoading, error } = useMenus();
  //           ↑ menus: MenuItem[] | undefined  ← 자동 추론!

  if (isLoading) return <Loading />;
  if (error) return <Error />;

  return menus.map((menu) => (
    <MenuItem
      key={menu.id}        // ✅ id: string 자동완성
      name={menu.name}     // ✅ name: string 자동완성
      price={menu.price}   // ✅ price: number 자동완성
    />
  ));
}
```

```
타입 전파 흐름:

api.get<MenuItem[]>     →  queryFn 반환: Promise<MenuItem[]>
                                │
                                ▼
                        useQuery 추론: data = MenuItem[]
                                │
                                ▼
                        컴포넌트에서: menus = MenuItem[]
                                │
                                ▼
                        JSX에서: menu.name, menu.price 자동완성
                                │
                                ▼
                        menu.nme → ❌ 컴파일 에러 (오타 잡아줌)
```

만약 `any`였다면:

```
api.get(...)            →  queryFn 반환: Promise<any>
                                │
                                ▼
                        useQuery 추론: data = any
                                │
                                ▼
                        컴포넌트에서: menus = any
                                │
                                ▼
                        JSX에서: menu.nme → ✅ 컴파일 통과 (오타 못 잡음!)
                                           런타임에 undefined 표시
```

---

## 정리

| 질문 | 답 |
|------|---|
| 왜 클래스? | `request()` 단일 통로 + 인터셉터 상태 보관 + `private` 캡슐화 |
| 왜 제네릭? | API마다 반환 타입이 다름 → `<T>`로 호출 시 지정 → 자동완성 + 오타 방지 |
| any 쓰면 안 되나? | 타입 체크 포기 → 런타임 에러로 이어짐 |
| React-Query와 관계? | `api.get<T>`의 T가 `useQuery`의 `data` 타입까지 자동 전파 |
