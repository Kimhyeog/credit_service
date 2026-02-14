# 미들웨어 & 인터셉터 레이어 학습 가이드

---

## 1. 개념 — 미들웨어/인터셉터란?

**요청(Request)과 응답(Response) 사이에 끼어들어 공통 작업을 자동으로 처리하는 중간 레이어**다.

핵심 아이디어: 모든 API 호출마다 반복해야 하는 작업을 **한 곳에서 한 번만** 정의하면, 모든 요청에 자동 적용된다.

```
미들웨어/인터셉터가 없는 경우:

  주문 생성 호출 ──→ 토큰 붙이기 + fetch + 에러 처리 + 로깅
  메뉴 조회 호출 ──→ 토큰 붙이기 + fetch + 에러 처리 + 로깅    ← 반복!
  결제 승인 호출 ──→ 토큰 붙이기 + fetch + 에러 처리 + 로깅    ← 반복!


미들웨어/인터셉터가 있는 경우:

  주문 생성 호출 ──┐
  메뉴 조회 호출 ──┼──→ [인터셉터] 토큰 + 에러 + 로깅 ──→ fetch
  결제 승인 호출 ──┘     ↑ 한 곳에서 한 번만 정의
```

### 미들웨어 vs 인터셉터 — 같은 개념, 다른 이름

| 용어                       | 사용되는 곳     | 예시                                                                        |
| -------------------------- | --------------- | --------------------------------------------------------------------------- |
| **미들웨어 (Middleware)**  | 서버 프레임워크 | Express.js `app.use()`, FastAPI `add_middleware()`, Next.js `middleware.ts` |
| **인터셉터 (Interceptor)** | HTTP 클라이언트 | axios `interceptors.request.use()`, Angular `HttpInterceptor`               |

둘 다 **"요청/응답 파이프라인에 끼어드는 함수"** 라는 점에서 동일한 패턴이다.

---

## 2. 동작 원리 — 파이프라인 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                        요청 파이프라인                            │
│                                                                 │
│  호출 코드          요청 인터셉터들              실제 fetch       │
│                                                                 │
│  api.get(...)  ──→  [인터셉터 1] ──→ [인터셉터 2] ──→  fetch()  │
│                     토큰 첨부        로깅                        │
│                                                                 │
│                ←──  [인터셉터 1] ←── [인터셉터 2] ←──  응답      │
│                     401 체크         로깅                        │
│                                                                 │
│                        응답 인터셉터들                            │
└─────────────────────────────────────────────────────────────────┘
```

요청이 나갈 때: 호출 코드 → 인터셉터 1 → 인터셉터 2 → ... → fetch
응답이 올 때: fetch → ... → 인터셉터 2 → 인터셉터 1 → 호출 코드

**양파 껍질(Onion)** 구조라고도 부른다:

```
        요청 방향 →
    ┌───────────────────────────┐
    │  인터셉터 1 (토큰 첨부)     │
    │  ┌───────────────────┐    │
    │  │ 인터셉터 2 (로깅)   │    │
    │  │  ┌─────────────┐  │    │
    │  │  │   fetch()   │  │    │
    │  │  └─────────────┘  │    │
    │  │ 인터셉터 2 (로깅)   │    │
    │  └───────────────────┘    │
    │  인터셉터 1 (401 체크)     │
    └───────────────────────────┘
        ← 응답 방향
```

---

## 3. 시나리오 3가지 — 실제 적용 예시

---

### 시나리오 1: 인증 토큰 자동 첨부

> **문제:** 모든 API 호출마다 `Authorization: Bearer xxx` 헤더를 수동으로 붙여야 한다.

#### 인터셉터 없이 (반복 코드):

```typescript
// 주문 생성
const token = localStorage.getItem("accessToken");
fetch("/api/orders", {
  headers: { Authorization: `Bearer ${token}` }, // 매번 작성
  body: JSON.stringify(data),
});

// 메뉴 조회
const token = localStorage.getItem("accessToken");
fetch("/api/menus", {
  headers: { Authorization: `Bearer ${token}` }, // 또 작성
});

// 결제 승인
const token = localStorage.getItem("accessToken");
fetch("/api/payments/confirm", {
  headers: { Authorization: `Bearer ${token}` }, // 또또 작성
});
```

```
주문 생성 ──→ 토큰 꺼내기 + 헤더 세팅 + fetch   ← 반복
메뉴 조회 ──→ 토큰 꺼내기 + 헤더 세팅 + fetch   ← 반복
결제 승인 ──→ 토큰 꺼내기 + 헤더 세팅 + fetch   ← 반복
```

#### 인터셉터 적용 후:

```typescript
// 요청 인터셉터: 토큰 자동 첨부
function authInterceptor(config: RequestConfig): RequestConfig {
  const token = localStorage.getItem("accessToken");
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
}

// 등록
api.addRequestInterceptor(authInterceptor);
```

```
주문 생성 ──┐                                           ┌──→ fetch("/api/orders")
            │     ┌─────────────────────────────┐       │    headers에 토큰 포함!
메뉴 조회 ──┼────→│  authInterceptor             │──────→┤
            │     │  토큰 꺼내기 + 헤더에 세팅     │       │
결제 승인 ──┘     └─────────────────────────────┘       └──→ fetch("/api/payments/confirm")
                   ↑ 한 곳에서 한 번만 작성                   headers에 토큰 포함!
```

**효과:** API 호출 코드에서 토큰 관련 코드가 완전히 사라진다. 토큰 저장 방식이 바뀌어도 (localStorage → cookie) 인터셉터 한 곳만 수정하면 된다.

---

### 시나리오 2: 401 에러 시 토큰 자동 갱신 (Refresh)

> **문제:** 토큰이 만료되면 401 에러가 발생. 매번 수동으로 갱신 로직을 넣을 수 없다.

#### 인터셉터 없이:

```typescript
// 주문 목록 조회
let res = await fetch("/api/orders", { headers: { Authorization: `Bearer ${token}` } });

if (res.status === 401) {
  // 토큰 갱신 시도
  const refreshRes = await fetch("/api/auth/refresh", { ... });
  const newToken = refreshRes.json().accessToken;
  localStorage.setItem("accessToken", newToken);
  // 원래 요청 재시도
  res = await fetch("/api/orders", { headers: { Authorization: `Bearer ${newToken}` } });
}
// ↑ 이 로직을 모든 API 호출마다...?
```

#### 응답 인터셉터 적용 후:

```typescript
// 응답 인터셉터: 401이면 토큰 갱신 후 재시도
async function refreshInterceptor(
  response: Response,
  originalRequest: RequestConfig,
) {
  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
    return fetch(originalRequest); // 원래 요청 재시도
  }
  return response;
}

api.addResponseInterceptor(refreshInterceptor);
```

```
시간 흐름 →

api.get("/api/orders")
  │
  ├──→ [요청 인터셉터: 토큰 첨부] ──→ fetch("/api/orders")
  │                                      │
  │                                      ▼
  │                                   서버: "토큰 만료됨"
  │                                      │
  │                                      ▼
  │                              응답: 401 Unauthorized
  │                                      │
  │    ┌─────────────────────────────────┘
  │    ▼
  │  [응답 인터셉터: 401 감지]
  │    │
  │    ├──→ POST /api/auth/refresh ──→ 새 토큰 받음
  │    │
  │    ├──→ localStorage에 새 토큰 저장
  │    │
  │    └──→ 원래 요청 재시도: fetch("/api/orders") + 새 토큰
  │                              │
  │                              ▼
  │                         응답: 200 OK + 주문 목록
  │                              │
  └──────────────────────────────┘

  호출한 코드는 이 과정을 전혀 모른다!
  그냥 주문 목록을 정상적으로 받는다.
```

**효과:** API 호출하는 쪽에서는 토큰 만료를 전혀 신경 쓸 필요 없다. 인터셉터가 알아서 갱신하고 재시도한다.

---

### 시나리오 3: 요청/응답 로깅 (디버깅용)

> **문제:** 개발 중에 어떤 API가 호출되고, 얼마나 걸리는지 추적하고 싶다.

#### 인터셉터 없이:

```typescript
// 매 호출마다 console.log...
console.log("[API] GET /api/menus 시작", Date.now());
const res = await fetch("/api/menus");
console.log("[API] GET /api/menus 완료", res.status, Date.now());

console.log("[API] POST /api/orders 시작", Date.now());
const res2 = await fetch("/api/orders", { method: "POST", body: ... });
console.log("[API] POST /api/orders 완료", res2.status, Date.now());
```

#### 인터셉터 적용 후:

```typescript
// 요청 인터셉터: 시작 시간 기록
function loggingRequestInterceptor(config: RequestConfig): RequestConfig {
  config.metadata = { startTime: Date.now() };
  console.log(`[API] → ${config.method} ${config.url}`);
  return config;
}

// 응답 인터셉터: 소요 시간 계산
function loggingResponseInterceptor(response: Response, config: RequestConfig) {
  const duration = Date.now() - config.metadata.startTime;
  console.log(`[API] ← ${response.status} ${config.url} (${duration}ms)`);
  return response;
}

api.addRequestInterceptor(loggingRequestInterceptor);
api.addResponseInterceptor(loggingResponseInterceptor);
```

```
콘솔 출력:

[API] → GET /api/menus
[API] ← 200 /api/menus (45ms)
[API] → POST /api/orders
[API] ← 201 /api/orders (120ms)
[API] → POST /api/payments/confirm
[API] ← 500 /api/payments/confirm (3200ms)    ← 문제 발견!
```

```
모든 API 호출
     │
     ▼
┌─────────────────────────┐
│  로깅 인터셉터 (요청)     │  → "[API] → GET /api/menus"  출력
│  시작 시간 = Date.now()  │
└────────────┬────────────┘
             │
             ▼
         fetch() 실행
             │
             ▼
┌─────────────────────────┐
│  로깅 인터셉터 (응답)     │  → "[API] ← 200 /api/menus (45ms)"  출력
│  소요 시간 계산           │
└────────────┬────────────┘
             │
             ▼
        호출 코드에 반환
```

**효과:** 모든 API의 성능을 한눈에 볼 수 있다. 프로덕션 배포 시 로깅 인터셉터만 제거하면 된다.

---

## 4. 인터셉터 조합 — 여러 개를 체이닝

실전에서는 인터셉터를 여러 개 조합한다:

```
api.get("/api/orders")
  │
  ▼
┌──────────────────────┐
│ 요청 인터셉터 1: 로깅   │  "[API] → GET /api/orders"
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 요청 인터셉터 2: 토큰   │  headers에 Authorization 추가
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 요청 인터셉터 3: 멱등성  │  POST/PATCH면 Idempotency-Key 추가
└──────────┬───────────┘
           ▼
       fetch() 실행
           │
           ▼
┌──────────────────────┐
│ 응답 인터셉터 3: 멱등성  │  (통과)
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 응답 인터셉터 2: 401    │  401이면 토큰 갱신 + 재시도
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 응답 인터셉터 1: 로깅   │  "[API] ← 200 /api/orders (45ms)"
└──────────┬───────────┘
           ▼
      호출 코드에 반환
```

---

## 5. axios vs fetch — 인터셉터 지원 비교

| 항목           | axios                            | fetch (native)         |
| -------------- | -------------------------------- | ---------------------- |
| 인터셉터 내장  | O (`interceptors.request.use`)   | X                      |
| 인터셉터 구현  | 라이브러리가 제공                | 직접 래퍼 클래스 작성  |
| 요청 취소      | `CancelToken`, `AbortController` | `AbortController`      |
| JSON 자동 파싱 | O (`res.data`)                   | X (`await res.json()`) |

**axios는 인터셉터가 내장**되어 있어 바로 쓸 수 있다:

```typescript
// axios — 내장 인터셉터
axios.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

**fetch는 인터셉터가 없다.** 직접 래퍼 클래스를 만들어야 한다:

```typescript
// fetch — 직접 구현해야 함
class ApiClient {
  private requestInterceptors: Function[] = [];

  addRequestInterceptor(fn: Function) {
    this.requestInterceptors.push(fn);
  }

  async request(config) {
    // 인터셉터를 순서대로 실행
    for (const interceptor of this.requestInterceptors) {
      config = interceptor(config);
    }
    return fetch(config.url, config);
  }
}
```

**이 프로젝트에서 axios 대신 fetch를 쓰는 이유:**

- Next.js가 `fetch`를 확장해서 ISR/캐싱을 지원한다 (`next: { revalidate: 60 }`)
- axios는 이 확장을 사용할 수 없다
- 따라서 인터셉터를 직접 구현하더라도 fetch 기반이 유리하다

---

## 6. 이 프로젝트에서의 적용

Toss-Sync POS에서는 인증이 없지만, 인터셉터 패턴을 적용하는 이유:

```
적용하는 인터셉터:

1. 에러 정규화 인터셉터     → res.ok 체크 + 에러 객체 통일
2. 로깅 인터셉터 (개발용)   → API 호출 추적
3. 멱등성 인터셉터 (Phase 8) → POST/PATCH에 Idempotency-Key 자동 첨부
```

자세한 구현은 → `docs/study/api-client-refactor.md` 참조
