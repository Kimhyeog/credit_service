# API 클라이언트 리팩토링 — Before vs After

> `frontend/src/services/api.ts`와 `frontend/src/lib/server-api.ts`에
> 인터셉터 패턴을 적용한 변경 내역과 그 이유를 정리한다.

---

## 1. 변경 요약

| 항목 | Before | After |
|------|--------|-------|
| **에러 처리** | get/post/patch 각각에 동일 코드 복사 | `errorInterceptor` 하나로 중앙화 |
| **로깅** | 없음 | `loggingInterceptor` (개발 환경 전용) |
| **확장성** | 새 공통 기능 추가 시 get/post/patch 모두 수정 | 인터셉터 하나만 추가 |
| **타입** | 에러 형태 비표준 (`throw { detail, status }`) | `ApiError` 인터페이스로 명시 |
| **서버 API** | 에러 메시지에 path 없음 | path 포함으로 디버깅 용이 |

---

## 2. 클라이언트 API (`services/api.ts`) — 상세 비교

### 변경점 1: 에러 처리 중복 제거

**Before — get, post, patch 마다 동일 코드 복사:**

```typescript
// get() 안에서:
if (!res.ok) {
  const error = await res.json().catch(() => ({ detail: "Unknown error" }));
  throw { detail: error.detail || res.statusText, status: res.status };
}

// post() 안에서:
if (!res.ok) {
  const error = await res.json().catch(() => ({ detail: "Unknown error" }));
  throw { detail: error.detail || res.statusText, status: res.status };  // 동일 코드!
}

// patch() 안에서:
if (!res.ok) {
  const error = await res.json().catch(() => ({ detail: "Unknown error" }));
  throw { detail: error.detail || res.statusText, status: res.status };  // 또 동일!
}
```

```
Before:

get()   ──→ fetch ──→ if(!ok) throw   ← 에러 처리 코드 1번째
post()  ──→ fetch ──→ if(!ok) throw   ← 에러 처리 코드 2번째 (복사)
patch() ──→ fetch ──→ if(!ok) throw   ← 에러 처리 코드 3번째 (복사)

문제: 에러 처리 로직 변경 시 3곳을 모두 수정해야 함
```

**After — 인터셉터 하나로 통합:**

```typescript
// 에러 인터셉터: 이 한 곳만 수정하면 모든 요청에 적용
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
```

```
After:

get()   ──→ request() ──┐
post()  ──→ request() ──┼──→ fetch ──→ [errorInterceptor] ──→ 반환
patch() ──→ request() ──┘              ↑ 에러 처리 코드 1곳만
```

### 변경점 2: request() 메서드로 단일 진입점 생성

**Before — get/post/patch 각각 fetch를 직접 호출:**

```typescript
class ApiClient {
  async get<T>(...) {
    const res = await fetch(url);        // ← 직접 fetch
    // 에러 처리...
    return res.json();
  }
  async post<T>(...) {
    const res = await fetch(url, {...});  // ← 직접 fetch
    // 에러 처리...
    return res.json();
  }
  async patch<T>(...) {
    const res = await fetch(url, {...});  // ← 직접 fetch
    // 에러 처리...
    return res.json();
  }
}
```

**After — 모든 메서드가 request()를 통과:**

```typescript
class ApiClient {
  // 모든 요청이 이 메서드를 통과
  private async request<T>(config: RequestConfig): Promise<T> {
    // 1) 요청 인터셉터 실행
    for (const interceptor of this.requestInterceptors) {
      config = interceptor(config);
    }
    // 2) fetch
    let response = await fetch(config.url, { ... });
    // 3) 응답 인터셉터 실행
    for (const interceptor of this.responseInterceptors) {
      response = await interceptor(response, config);
    }
    return response.json();
  }

  async get<T>(...) {
    return this.request<T>({ url, method: "GET", headers: {} });
  }
  async post<T>(...) {
    return this.request<T>({ url, method: "POST", headers: {...}, body });
  }
  async patch<T>(...) {
    return this.request<T>({ url, method: "PATCH", headers: {...}, body });
  }
}
```

```
Before:                                After:

get ──→ fetch() ──→ 에러 처리          get ──→ request() ──→ [인터셉터들] ──→ fetch()
post ──→ fetch() ──→ 에러 처리         post ──→ request() ──→ [인터셉터들] ──→ fetch()
patch ──→ fetch() ──→ 에러 처리        patch ──→ request() ──→ [인터셉터들] ──→ fetch()
   ↑ 3개의 독립적 파이프라인               ↑ 1개의 공유 파이프라인
```

### 변경점 3: 로깅 인터셉터 추가

**Before:** 로깅 없음. API 호출이 실패하면 어디서 문제인지 추적 어려움.

**After:**

```typescript
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
```

```
개발 중 브라우저 콘솔:

[API] → GET http://localhost:8000/api/menus
[API] ← 200 GET http://localhost:8000/api/menus
[API] → POST http://localhost:8000/api/orders
[API] ← 201 POST http://localhost:8000/api/orders
[API] → POST http://localhost:8000/api/payments/confirm
[API] ← 500 POST http://localhost:8000/api/payments/confirm   ← 문제 즉시 발견
```

프로덕션에서는 `process.env.NODE_ENV !== "development"`이므로 로깅이 자동으로 꺼진다.

### 변경점 4: ApiError 타입 명시

**Before:**

```typescript
// throw할 때 형태가 암묵적 — 받는 쪽에서 타입을 모름
throw { detail: error.detail || res.statusText, status: res.status };
```

**After:**

```typescript
// 명시적 인터페이스 export
export interface ApiError {
  detail: string;
  status: number;
}

// throw할 때 타입 단언
throw { detail: body.detail || response.statusText, status: response.status } as ApiError;

// 사용하는 쪽에서 타입을 import해서 쓸 수 있음
import type { ApiError } from "@/services/api";

try {
  await api.post("/api/orders", data);
} catch (e) {
  const error = e as ApiError;
  if (error.status === 409) {
    // 중복 주문 처리
  }
}
```

---

## 3. 서버 API (`lib/server-api.ts`) — 상세 비교

서버 API는 인터셉터 클래스를 도입하지 않았다. 대신 기존 함수 래퍼에 **로깅 + 에러 메시지 개선**만 추가했다.

### 변경점: 에러 메시지에 path 포함 + 개발 로깅

**Before:**

```typescript
if (!res.ok) {
  throw new Error(`Server API error: ${res.status} ${res.statusText}`);
  //                                                ↑ 어떤 API에서 실패했는지 모름
}
```

**After:**

```typescript
if (!res.ok) {
  throw new Error(`Server API error: ${res.status} ${res.statusText} (${path})`);
  //                                                                  ↑ path 추가
}
```

```
Before 에러 로그: "Server API error: 500 Internal Server Error"
                   ↑ 어떤 API? /api/menus? /api/orders?

After 에러 로그:  "Server API error: 500 Internal Server Error (/api/orders)"
                   ↑ /api/orders에서 실패했다는 걸 바로 알 수 있음
```

개발 환경 로깅도 추가:

```
터미널 (Next.js 서버 로그):

[Server API] → GET /api/menus
[Server API] ← 200 /api/menus
[Server API] → GET /api/orders?status=PAID
[Server API] ← 200 /api/orders?status=PAID
```

### 왜 서버 API는 인터셉터 클래스를 안 쓰는가?

```
클라이언트 API:
  ┌─────────────────────────────────────┐
  │ useMenus() ──→ api.get("/api/menus")│
  │ useOrders() ──→ api.get("/api/orders")
  │ useCreateOrder() ──→ api.post(...)  │
  │ useCancelOrder() ──→ api.patch(...) │
  │ ... (10개+ 호출 지점)               │
  │                                     │
  │ Phase 8: 멱등성 인터셉터 추가        │
  │ 향후: 인증 인터셉터 추가 가능        │
  │                                     │
  │ → 인터셉터 체인이 가치 있음          │
  └─────────────────────────────────────┘

서버 API:
  ┌─────────────────────────────────────┐
  │ getMenus()   ──→ serverFetch(...)   │
  │ getOrders()  ──→ serverFetch(...)   │
  │ getOrder()   ──→ serverFetch(...)   │
  │ (3개 함수)                          │
  │                                     │
  │ Next.js fetch 확장을 써야 함         │
  │ 인터셉터 추가 계획 없음              │
  │                                     │
  │ → 함수 래퍼로 충분, 과도 설계 방지   │
  └─────────────────────────────────────┘
```

---

## 4. Phase 8에서의 확장 미리보기

인터셉터 패턴의 진짜 가치는 **Phase 8 (멱등성)** 에서 드러난다.
POST/PATCH 요청에 `Idempotency-Key` 헤더를 자동으로 붙여야 하는데:

**인터셉터가 없었다면:**

```typescript
// useCreateOrder.ts
api.post("/api/orders", data, {
  headers: { "Idempotency-Key": generateKey() },  // 직접 붙임
});

// useCancelOrder.ts
api.patch("/api/orders/xxx/cancel", null, {
  headers: { "Idempotency-Key": generateKey() },  // 또 직접 붙임
});

// useConfirmPayment.ts
api.post("/api/payments/confirm", data, {
  headers: { "Idempotency-Key": generateKey() },  // 또또 직접 붙임
});

// → 빠뜨리면 중복 결제 발생!
```

**인터셉터가 있으면:**

```typescript
// Phase 8에서 인터셉터 하나만 추가
const idempotencyInterceptor: RequestInterceptor = (config) => {
  if (config.method === "POST" || config.method === "PATCH") {
    config.headers["Idempotency-Key"] = generateIdempotencyKey();
  }
  return config;
};

api.addRequestInterceptor(idempotencyInterceptor);
// → 모든 POST/PATCH에 자동 적용, 빠뜨릴 수 없음
```

```
Before (인터셉터 없음):                    After (인터셉터 있음):

POST /orders     → 키 수동 첨부           POST /orders     ──┐
PATCH /cancel    → 키 수동 첨부  ← 실수!  PATCH /cancel    ──┼→ [멱등성 인터셉터] → 키 자동
POST /confirm    → 키 깜빡 누락  ← 위험!  POST /confirm    ──┘
```

---

## 5. 전체 아키텍처 비교

```
Before:

  get()  ──→ fetch() ──→ 에러처리 ──→ json()     ┐
  post() ──→ fetch() ──→ 에러처리 ──→ json()     ├ 3개의 독립 파이프라인
  patch()──→ fetch() ──→ 에러처리 ──→ json()     ┘
  (중복 코드 3벌, 확장 시 3곳 수정)

After:

  get()  ──┐
  post() ──┼──→ request() ──→ [요청 인터셉터들] ──→ fetch() ──→ [응답 인터셉터들] ──→ json()
  patch()──┘    ↑ 단일 진입점     ↑ 플러그인처럼       ↑ 1회         ↑ 플러그인처럼
                                    추가/제거 가능                      추가/제거 가능
```
