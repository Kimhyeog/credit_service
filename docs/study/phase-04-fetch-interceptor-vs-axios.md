# fetch 인터셉터 vs axios — Next.js App Router에서의 선택

> Next.js App Router 환경에서 왜 axios 대신 fetch 기반 인터셉터를 사용하는지,
> 실제 코드 사례와 ISR 캐싱 효과를 비교한다.

---

## 1. 핵심 결론

```
Next.js App Router 프로젝트에서는:

  서버 컴포넌트 → fetch 필수 (ISR/캐싱은 fetch만 지원)
  클라이언트 컴포넌트 → fetch 권장 (서버와 통일 + 인터셉터 직접 구현)

  axios → Pages Router 시절의 선택. App Router에서는 서버 기능을 못 쓰게 됨.
```

---

## 2. axios가 안 되는 이유 — ISR 캐싱 사례

### 사례: 메뉴 목록 조회 (60초마다 갱신)

**fetch로 구현 (ISR 가능):**

```typescript
// lib/server-api.ts — Server Component에서 호출
const res = await fetch("http://localhost:8000/api/menus", {
  next: { revalidate: 60, tags: ["menus"] },
  //      ↑ Next.js 확장 옵션
  //        60초 동안 캐시, "menus" 태그로 수동 무효화 가능
});
```

```
요청 흐름 (fetch + ISR):

시간 0초: 첫 방문
  브라우저 → Next.js 서버 → FastAPI → DB 조회 → 메뉴 8개 반환
                  │
                  └→ 결과를 캐시에 저장 (60초 TTL)

시간 30초: 두 번째 방문
  브라우저 → Next.js 서버 → 캐시에서 즉시 반환 ✅
                           (FastAPI 호출 안 함!)
                           응답 시간: ~5ms

시간 65초: 세 번째 방문
  브라우저 → Next.js 서버 → 캐시 반환 (stale) + 백그라운드 재생성
                  │                              │
                  │                              └→ FastAPI → DB → 새 데이터
                  └→ 사용자는 기존 캐시를 즉시 받음 (기다리지 않음)

시간 66초: 네 번째 방문
  브라우저 → Next.js 서버 → 새로 생성된 캐시 반환 ✅
```

**같은 코드를 axios로 시도하면:**

```typescript
// axios로 ISR 시도 — ❌ 불가능
import axios from "axios";

const res = await axios.get("http://localhost:8000/api/menus", {
  next: { revalidate: 60 },  // ❌ axios는 이 옵션을 모름 — 무시됨
});
```

```
요청 흐름 (axios — ISR 불가):

시간 0초: 첫 방문
  브라우저 → Next.js 서버 → FastAPI → DB 조회 → 메뉴 8개 반환
                           (캐시 없음)

시간 30초: 두 번째 방문
  브라우저 → Next.js 서버 → FastAPI → DB 조회 → 메뉴 8개 반환
                           (또 조회! 캐시가 없으니까)
                           응답 시간: ~150ms

시간 65초: 세 번째 방문
  브라우저 → Next.js 서버 → FastAPI → DB 조회 → 메뉴 8개 반환
                           (매번 조회...)
```

**성능 비교:**

```
100명이 1분 안에 메뉴 페이지 방문 시:

fetch + ISR:
  FastAPI 호출 횟수: 1~2회 (첫 요청 + 60초 후 재생성)
  평균 응답 시간: ~5ms (캐시 히트)
  DB 부하: 거의 없음

axios (ISR 불가):
  FastAPI 호출 횟수: 100회 (매 요청마다)
  평균 응답 시간: ~150ms (매번 DB 조회)
  DB 부하: 100배
```

### Next.js가 fetch만 확장한 이유

```
Next.js 내부 구조:

  fetch()를 호출하면:
  ┌──────────────────────────────────────────────┐
  │  Next.js가 글로벌 fetch를 덮어씀 (monkey-patch) │
  │                                              │
  │  원래 fetch:  fetch(url, init)               │
  │  Next.js fetch: fetch(url, {                 │
  │    ...init,                                  │
  │    next: { revalidate, tags }  ← 추가 옵션   │
  │  })                                          │
  │                                              │
  │  이 추가 옵션으로:                             │
  │  - 응답을 서버 캐시에 저장                     │
  │  - revalidate 시간 후 백그라운드 재생성         │
  │  - tags로 수동 무효화 (revalidateTag)          │
  └──────────────────────────────────────────────┘

  axios.get()를 호출하면:
  ┌──────────────────────────────────────────────┐
  │  axios는 내부적으로 XMLHttpRequest 또는        │
  │  Node.js http 모듈을 사용                     │
  │                                              │
  │  Next.js가 확장한 fetch를 거치지 않음          │
  │  → ISR, 캐싱, 태그 전부 사용 불가              │
  └──────────────────────────────────────────────┘
```

---

## 3. fetch 기반 인터셉터 — 실제 구현 사례

"axios의 인터셉터가 편한데, fetch에는 없잖아?" → 직접 만들면 된다.

### 사례 1: 이 프로젝트의 ApiClient (Toss-Sync POS)

```typescript
// services/api.ts

// 인터셉터 타입
type RequestInterceptor = (config: RequestConfig) => RequestConfig;
type ResponseInterceptor = (response: Response, config: RequestConfig) => Response | Promise<Response>;

class ApiClient {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  addRequestInterceptor(fn: RequestInterceptor) {
    this.requestInterceptors.push(fn);
  }

  addResponseInterceptor(fn: ResponseInterceptor) {
    this.responseInterceptors.push(fn);
  }

  private async request<T>(config: RequestConfig): Promise<T> {
    // 요청 인터셉터 실행
    for (const fn of this.requestInterceptors) {
      config = fn(config);
    }

    let response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: config.body,
    });

    // 응답 인터셉터 실행
    for (const fn of this.responseInterceptors) {
      response = await fn(response, config);
    }

    return response.json();
  }

  async get<T>(path: string): Promise<T> {
    return this.request({ url: `${this.baseUrl}${path}`, method: "GET", headers: {} });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request({
      url: `${this.baseUrl}${path}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

// 인터셉터 등록
const api = new ApiClient(BASE_URL);
api.addRequestInterceptor(loggingInterceptor);
api.addResponseInterceptor(errorInterceptor);
```

```
사용하는 쪽 코드:

// hooks/useMenus.ts
const { data } = useQuery({
  queryKey: ["menus"],
  queryFn: () => api.get<MenuItem[]>("/api/menus"),
  //             ↑ 인터셉터가 자동으로 로깅 + 에러 처리
});

// hooks/useCreateOrder.ts
const mutation = useMutation({
  mutationFn: (data) => api.post<OrderResponse>("/api/orders", data),
  //                     ↑ 인터셉터가 자동으로 로깅 + 에러 처리
  //                       Phase 8에서는 멱등성 키도 자동 첨부
});
```

### 사례 2: axios 인터셉터와 1:1 비교

같은 기능을 axios와 fetch 인터셉터로 나란히 구현:

**에러 처리:**

```typescript
// axios 방식
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    throw {
      detail: error.response?.data?.detail || "Unknown error",
      status: error.response?.status || 500,
    };
  }
);

// fetch 인터셉터 방식 (이 프로젝트)
api.addResponseInterceptor(async (response, config) => {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw {
      detail: body.detail || response.statusText,
      status: response.status,
    };
  }
  return response;
});
```

**로깅:**

```typescript
// axios 방식
axios.interceptors.request.use((config) => {
  console.log(`[API] → ${config.method} ${config.url}`);
  return config;
});
axios.interceptors.response.use((response) => {
  console.log(`[API] ← ${response.status} ${response.config.url}`);
  return response;
});

// fetch 인터셉터 방식 (이 프로젝트)
api.addRequestInterceptor((config) => {
  console.log(`[API] → ${config.method} ${config.url}`);
  return config;
});
api.addResponseInterceptor((response, config) => {
  console.log(`[API] ← ${response.status} ${config.url}`);
  return response;
});
```

**멱등성 키 (Phase 8):**

```typescript
// axios 방식
axios.interceptors.request.use((config) => {
  if (config.method === "post" || config.method === "patch") {
    config.headers["Idempotency-Key"] = generateKey();
  }
  return config;
});

// fetch 인터셉터 방식 (이 프로젝트)
api.addRequestInterceptor((config) => {
  if (config.method === "POST" || config.method === "PATCH") {
    config.headers["Idempotency-Key"] = generateKey();
  }
  return config;
});
```

```
결론: 문법이 거의 같다.

axios:  axios.interceptors.request.use(fn)   ← 라이브러리가 제공
fetch:  api.addRequestInterceptor(fn)         ← 직접 만든 메서드

하는 일은 동일하다.
```

---

## 4. 이 프로젝트의 전체 구조 — fetch 이원화

```
┌──────────────────────────────────────────────────────────────┐
│                      프론트엔드 (Next.js)                      │
│                                                              │
│  Server Component (page.tsx)         Client Component (훅)    │
│  ┌────────────────────────┐         ┌──────────────────────┐ │
│  │ lib/server-api.ts      │         │ services/api.ts      │ │
│  │                        │         │                      │ │
│  │ fetch + Next.js 확장    │         │ fetch + 인터셉터 체인  │ │
│  │ ┌──────────────────┐  │         │ ┌──────────────────┐ │ │
│  │ │ revalidate: 60   │  │         │ │ 로깅 인터셉터     │ │ │
│  │ │ cache: 'no-store' │  │         │ │ 에러 인터셉터     │ │ │
│  │ │ tags: ['menus']  │  │         │ │ 멱등성 인터셉터   │ │ │
│  │ └──────────────────┘  │         │ └──────────────────┘ │ │
│  └───────────┬────────────┘         └──────────┬───────────┘ │
│              │                                 │             │
└──────────────┼─────────────────────────────────┼─────────────┘
               │ 서버→서버 (내부)                  │ 브라우저→서버
               ▼                                 ▼
         ┌─────────────────────────────────────────┐
         │           백엔드 (FastAPI :8000)          │
         └─────────────────────────────────────────┘
```

### 각 위치에서 fetch를 쓰는 이유

```
lib/server-api.ts (서버용):
  ┌────────────────────────────────────────────┐
  │ fetch를 써야 하는 이유:                      │
  │ • Next.js가 fetch만 확장함 (ISR/캐싱)       │
  │ • axios는 이 확장을 사용할 수 없음            │
  │                                            │
  │ 인터셉터 클래스를 안 쓰는 이유:               │
  │ • 호출 지점 3개뿐 (getMenus, getOrders, ...) │
  │ • 추가 인터셉터 계획 없음                    │
  │ • serverFetch() 함수 래퍼로 충분             │
  └────────────────────────────────────────────┘

services/api.ts (클라이언트용):
  ┌────────────────────────────────────────────┐
  │ fetch를 써야 하는 이유:                      │
  │ • 서버 API와 통일 (fetch 하나로)              │
  │ • 추가 라이브러리 불필요 (번들 사이즈 절약)    │
  │                                            │
  │ 인터셉터 클래스를 쓰는 이유:                  │
  │ • 호출 지점 10개+ (각종 훅에서 사용)           │
  │ • Phase 8에서 멱등성 인터셉터 추가 예정        │
  │ • 향후 인증 인터셉터 추가 가능                │
  │ • addRequestInterceptor()로 확장 용이        │
  └────────────────────────────────────────────┘
```

---

## 5. ISR 캐싱의 실제 효과 — 숫자로 비교

이 프로젝트의 메뉴 조회를 기준으로:

### 시나리오: 점심 피크타임, 1시간 동안 200명 방문

```
fetch + ISR (revalidate: 60):
  ┌───────────────────────────────────────────┐
  │ FastAPI 호출 횟수:  60회 (1분마다 1회)      │
  │ DB 쿼리 횟수:      60회                    │
  │ 평균 응답 시간:     ~5ms (캐시 히트)        │
  │ 서버 CPU 부하:      낮음                   │
  └───────────────────────────────────────────┘

axios (캐싱 없음, 매번 SSR):
  ┌───────────────────────────────────────────┐
  │ FastAPI 호출 횟수:  200회 (매 방문마다)     │
  │ DB 쿼리 횟수:      200회                   │
  │ 평균 응답 시간:     ~150ms (매번 조회)      │
  │ 서버 CPU 부하:      높음                   │
  └───────────────────────────────────────────┘
```

```
비교 그래프 (FastAPI 호출 횟수, 1시간):

fetch + ISR:    ████░░░░░░░░░░░░░░░░░░░░░░  60회
axios (no ISR): ████████████████████████████████████████  200회
                                                       3.3배 차이
```

```
비교 그래프 (평균 응답 시간):

fetch + ISR:    █░░░░░░░░░░░░░░░  5ms
axios (no ISR): ██████████████████████████████  150ms
                                              30배 차이
```

### 주문 목록은 왜 ISR을 안 쓰는가?

```
메뉴 (getMenus):
  revalidate: 60  ← 메뉴는 1분 동안 안 바뀜
  캐시해도 문제 없음

주문 목록 (getOrders):
  cache: 'no-store'  ← 매 요청마다 최신 데이터
  캐시하면 안 됨!

이유:
  메뉴: 사장님이 가끔 수정 → 1분 지연 OK
  주문: 고객이 방금 주문 → KDS에 즉시 반영되어야 함 → 캐시 불가
```

---

## 6. 정리 — 언제 무엇을 쓸 것인가

```
┌─────────────────────────────────────────────────────────────┐
│                    프로젝트 선택 가이드                        │
│                                                             │
│  Next.js App Router 사용?                                   │
│  ├─ Yes → fetch 기반 (서버 ISR/캐싱 필요)                    │
│  │        ├─ 서버 컴포넌트: fetch + Next.js 확장             │
│  │        └─ 클라이언트: fetch + 인터셉터 직접 구현           │
│  │            └─ 인터셉터 10개+ 필요? → ky, ofetch 라이브러리 │
│  │                                                          │
│  └─ No (React SPA, Pages Router)                            │
│     └─ axios 사용 OK                                        │
│        └─ interceptors.request.use() 내장이라 편함           │
└─────────────────────────────────────────────────────────────┘
```

| 상황 | 추천 | 이유 |
|------|------|------|
| Next.js App Router + SSR/ISR | **fetch** | ISR/캐싱은 fetch만 지원 |
| Next.js App Router + 클라이언트만 | **fetch** (인터셉터 직접) | 서버와 통일, 번들 절약 |
| React SPA (CRA, Vite) | **axios** | 인터셉터 내장, ISR 불필요 |
| React Native | **axios** | Next.js fetch 확장 없음 |
| Pages Router (레거시) | **axios** | SSR에서도 ISR 불필요 |
