# Phase 12 — 중복 탭 방지 & 엣지 케이스 처리

## 목표

- 여러 탭에서 동시 결제 방지 (LocalStorage 기반 잠금)
- 결제 성공 페이지의 confirm API 중복 호출 방지
- 백엔드 글로벌 에러 핸들러로 안정성 확보
- 네트워크 오프라인 감지 및 결제 차단

---

## 왜 필요한가

현재 구현에서 다음 엣지 케이스가 미처리:

| 상황 | 현재 동작 | 문제 |
|------|-----------|------|
| 탭 A에서 결제 중, 탭 B에서도 결제 시도 | 두 탭 모두 결제 진행 | 동일 주문 이중 결제 가능 |
| 결제 성공 페이지 새로고침 | `useEffect` 재실행 | confirm API 중복 호출 → 400/409 에러 |
| Confirm 후 WAL 미정리 | WAL 엔트리 남아있음 | 다음 방문 시 복구 배너 잘못 표시 |
| 백엔드 미처리 예외 (Prisma, Toss) | Python traceback 노출 | 보안/UX 문제 |
| 인터넷 끊긴 상태에서 결제 시도 | fetch 실패 → 에러 | 사용자에게 명확한 안내 없음 |

---

## 현재 코드 상태 분석

### usePayment.ts (중복 방지 없음)
```typescript
// 현재: acquireLock 없이 바로 결제 시작
const startPayment = useCallback(async (params) => {
  dispatch({ type: "START_PAYMENT" });
  const walId = wal.write({ ... });
  // ...
}, []);
```

### payment/success/page.tsx (재진입 방지 없음)
```typescript
// 현재: searchParams 변경마다 실행됨 → Strict Mode에서 2회 실행
useEffect(() => {
  paymentService.confirmPayment({ paymentKey, orderId, amount })
    .then(...)
    .catch(...);
}, [searchParams]);  // ← 의존성 문제
```

### backend/app/middleware/ (에러 핸들러 없음)
```
middleware/
└── idempotency.py   ← 이것만 존재
```

---

## 생성/수정 파일 (8개)

### 신규 생성 (4개)

| # | 파일 | 설명 |
|---|------|------|
| 1 | `src/hooks/usePaymentLock.ts` | LocalStorage 기반 결제 잠금 (5분 TTL) |
| 2 | `src/hooks/useOnlineStatus.ts` | navigator.onLine 감지 훅 |
| 3 | `src/components/common/OfflineBanner.tsx` | 오프라인 배너 컴포넌트 |
| 4 | `backend/app/middleware/error_handler.py` | 글로벌 에러 핸들러 |

### 수정 (4개)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 5 | `src/hooks/usePayment.ts` | usePaymentLock + 오프라인 체크 통합 |
| 6 | `src/app/payment/success/page.tsx` | 재진입 방지 + WAL 정리 + lock 해제 |
| 7 | `src/app/payment/fail/page.tsx` | lock 해제 |
| 8 | `backend/app/main.py` | error_handler 등록 |

---

## 구현 순서

### Step 1. usePaymentLock 훅

**파일:** `frontend/src/hooks/usePaymentLock.ts`

```typescript
const LOCK_KEY = "toss_sync_pos_payment_lock";
const LOCK_TTL_MS = 5 * 60 * 1000; // 5분

interface LockData {
  lockedAt: number;
  tabId: string;
}

// 탭별 고유 ID (페이지 로드마다 생성)
const TAB_ID = crypto.randomUUID();

/** 잠금 획득 — 성공 시 true, 이미 다른 탭에서 잠금 중이면 false */
export function acquireLock(): boolean {
  const raw = localStorage.getItem(LOCK_KEY);

  if (raw) {
    try {
      const lock: LockData = JSON.parse(raw);
      const elapsed = Date.now() - lock.lockedAt;

      // 같은 탭이면 이미 잠금 소유 → true
      if (lock.tabId === TAB_ID) return true;

      // 다른 탭이지만 TTL 미만 → 잠금 실패
      if (elapsed < LOCK_TTL_MS) return false;

      // TTL 초과 → 만료된 잠금, 새로 획득
    } catch {
      // 파싱 실패 → 새로 획득
    }
  }

  localStorage.setItem(
    LOCK_KEY,
    JSON.stringify({ lockedAt: Date.now(), tabId: TAB_ID })
  );
  return true;
}

/** 잠금 해제 (자신의 잠금만 해제) */
export function releaseLock(): void {
  const raw = localStorage.getItem(LOCK_KEY);
  if (!raw) return;

  try {
    const lock: LockData = JSON.parse(raw);
    // 자신의 잠금만 해제 (다른 탭의 잠금은 건드리지 않음)
    if (lock.tabId === TAB_ID) {
      localStorage.removeItem(LOCK_KEY);
    }
  } catch {
    localStorage.removeItem(LOCK_KEY);
  }
}

/** 현재 잠금 상태 확인 */
export function isLocked(): boolean {
  const raw = localStorage.getItem(LOCK_KEY);
  if (!raw) return false;

  try {
    const lock: LockData = JSON.parse(raw);
    return Date.now() - lock.lockedAt < LOCK_TTL_MS;
  } catch {
    return false;
  }
}
```

**포인트:**
- 훅이 아닌 **순수 함수** — React 외부(usePayment, success/fail 페이지)에서도 호출 가능
- `tabId`로 같은 탭 vs 다른 탭 구분
- TTL 5분 — Toss 결제창 최대 대기 시간 고려

---

### Step 2. useOnlineStatus 훅

**파일:** `frontend/src/hooks/useOnlineStatus.ts`

```typescript
"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true; // SSR에서는 항상 online
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

**포인트:**
- `useSyncExternalStore` 사용 — React 19 권장 패턴 (tearing 방지)
- SSR용 `getServerSnapshot` 필수 (Next.js App Router)

---

### Step 3. OfflineBanner 컴포넌트

**파일:** `frontend/src/components/common/OfflineBanner.tsx`

```typescript
"use client";

import styled from "@emotion/styled";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const Banner = styled.div`
  background: ${({ theme }) => theme.colors.warning};
  color: white;
  text-align: center;
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
`;

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return <Banner>인터넷 연결이 끊어졌습니다. 연결을 확인해주세요.</Banner>;
}
```

**배치:** `POSClientShell`, `KioskShell`, `TableOrderShell`의 `<Layout>` 최상단에 추가.

```tsx
<Layout>
  <OfflineBanner />   {/* ← 추가 */}
  <TopBar>...</TopBar>
  ...
</Layout>
```

---

### Step 4. 글로벌 에러 핸들러 (백엔드)

**파일:** `backend/app/middleware/error_handler.py`

```python
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("toss_sync_pos")


def register_error_handlers(app: FastAPI):
    """앱에 글로벌 에러 핸들러 등록"""

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """미처리 예외 → 500"""
        logger.exception(f"Unhandled error: {request.method} {request.url.path}")
        return JSONResponse(
            status_code=500,
            content={"detail": "서버 내부 오류가 발생했습니다."},
        )

    # Prisma 에러 처리
    try:
        from prisma.errors import PrismaError, RecordNotFoundError

        @app.exception_handler(RecordNotFoundError)
        async def prisma_not_found_handler(request: Request, exc: RecordNotFoundError):
            return JSONResponse(
                status_code=404,
                content={"detail": "요청한 리소스를 찾을 수 없습니다."},
            )

        @app.exception_handler(PrismaError)
        async def prisma_error_handler(request: Request, exc: PrismaError):
            logger.exception(f"Prisma error: {request.method} {request.url.path}")
            return JSONResponse(
                status_code=500,
                content={"detail": "데이터베이스 오류가 발생했습니다."},
            )
    except ImportError:
        pass

    # httpx 에러 처리 (Toss API)
    try:
        from httpx import HTTPStatusError

        @app.exception_handler(HTTPStatusError)
        async def httpx_error_handler(request: Request, exc: HTTPStatusError):
            logger.error(
                f"External API error: {exc.response.status_code} "
                f"{request.method} {request.url.path}"
            )
            # Toss API 에러 본문 전달 시도
            try:
                body = exc.response.json()
                detail = body.get("message", "결제 서비스 오류가 발생했습니다.")
            except Exception:
                detail = "결제 서비스 오류가 발생했습니다."

            return JSONResponse(
                status_code=502,
                content={"detail": detail},
            )
    except ImportError:
        pass
```

**포인트:**
- `Exception` 핸들러를 **마지막에 등록해도** FastAPI가 더 구체적인 핸들러를 먼저 매칭함
- Prisma/httpx import를 `try/except`로 감싸 의존성 누락 시에도 앱 기동 가능
- 로그에는 상세 정보, 응답에는 사용자 친화적 메시지

---

### Step 5. main.py에 에러 핸들러 등록

**파일:** `backend/app/main.py`

```python
# 기존 import 아래에 추가
from app.middleware.error_handler import register_error_handlers

# app 생성 후, 라우터 등록 전에 호출
register_error_handlers(app)
```

등록 순서:
```python
app = FastAPI(...)
app.add_middleware(CORSMiddleware, ...)
app.add_middleware(IdempotencyMiddleware)
register_error_handlers(app)          # ← 추가
app.include_router(menus.router)
# ...
```

---

### Step 6. usePayment에 잠금 + 오프라인 통합

**파일:** `frontend/src/hooks/usePayment.ts`

변경 전:
```typescript
const startPayment = useCallback(async (params: PaymentFlowParams) => {
  const wal = walRef.current;
  try {
    dispatch({ type: "START_PAYMENT" });
    // ...
```

변경 후:
```typescript
import { acquireLock, releaseLock } from "@/hooks/usePaymentLock";

const startPayment = useCallback(async (params: PaymentFlowParams) => {
  // 1. 오프라인 체크
  if (!navigator.onLine) {
    dispatch({
      type: "CONFIRM_FAIL",
      error: "인터넷 연결을 확인해주세요.",
    });
    return;
  }

  // 2. 중복 탭 잠금
  if (!acquireLock()) {
    dispatch({
      type: "CONFIRM_FAIL",
      error: "다른 탭에서 결제가 진행 중입니다.",
    });
    return;
  }

  const wal = walRef.current;
  try {
    dispatch({ type: "START_PAYMENT" });
    // ... 기존 로직 동일
  } catch (error) {
    releaseLock();   // 에러 시 잠금 해제
    dispatch({
      type: "CONFIRM_FAIL",
      error: error instanceof Error ? error.message : "결제 중 오류 발생",
    });
  }
}, []);
```

**주의:** 정상 흐름에서는 Toss SDK가 리다이렉트하므로 `releaseLock()`은 success/fail 페이지에서 호출.

---

### Step 7. 결제 성공 페이지 안정성 강화

**파일:** `frontend/src/app/payment/success/page.tsx`

```typescript
// 추가 import
import { useRef } from "react";
import { WALManager } from "@/services/recovery/WALManager";
import { releaseLock } from "@/hooks/usePaymentLock";

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [error, setError] = useState<string>("");
  const confirmedRef = useRef(false);  // ← 재진입 방지 플래그

  const returnTo = searchParams.get("returnTo") || "/";

  useEffect(() => {
    // 재진입 방지 — Strict Mode, searchParams 재평가 등
    if (confirmedRef.current) return;

    const paymentKey = searchParams.get("paymentKey");
    const orderId = searchParams.get("orderId");
    const amount = searchParams.get("amount");

    if (!paymentKey || !orderId || !amount) {
      setStatus("error");
      setError("결제 정보가 누락되었습니다.");
      releaseLock();
      return;
    }

    confirmedRef.current = true;  // ← 즉시 플래그 설정

    const paymentService = createPaymentService();
    paymentService
      .confirmPayment({ paymentKey, orderId, amount: Number(amount) })
      .then((res) => {
        setResult(res);
        setStatus("success");

        // WAL에서 해당 주문 정리
        const wal = new WALManager();
        const entries = wal.readAll().filter((e) => e.orderId === orderId);
        entries.forEach((e) => wal.remove(e.id));
      })
      .catch((err) => {
        confirmedRef.current = false;  // 실패 시 재시도 허용
        setError(err.detail || "결제 승인에 실패했습니다.");
        setStatus("error");
      })
      .finally(() => {
        releaseLock();
      });
  }, [searchParams]);

  // ... 나머지 JSX 동일
}
```

**핵심:**
- `confirmedRef.current`를 즉시 `true`로 설정 → 두 번째 실행 차단
- `.catch`에서 `confirmedRef.current = false` → 실패 시 새로고침으로 재시도 가능
- `.finally`에서 `releaseLock()` → 성공/실패 무관하게 잠금 해제
- WAL 정리: orderId로 매칭하여 `wal.remove()`

---

### Step 8. 결제 실패 페이지 잠금 해제

**파일:** `frontend/src/app/payment/fail/page.tsx`

```typescript
// 추가 import
import { useEffect } from "react";
import { releaseLock } from "@/hooks/usePaymentLock";

export default function PaymentFailPage() {
  // ... 기존 코드

  // 페이지 진입 시 잠금 해제
  useEffect(() => {
    releaseLock();
  }, []);

  return (
    // ... 기존 JSX 동일
  );
}
```

---

## 검증

```bash
# 1. 빌드 확인
cd frontend && npm run build

# 2. 백엔드 에러 핸들러 테스트
# 존재하지 않는 주문 조회 → 적절한 에러 응답 (traceback 없음)
curl http://localhost:8000/api/orders/nonexistent-id

# 3. 중복 탭 테스트 (수동)
# 탭 A: POS 화면에서 결제 시작
# 탭 B: POS 화면에서 결제 시도 → "다른 탭에서 결제가 진행 중입니다" 메시지
# DevTools > Application > Local Storage > toss_sync_pos_payment_lock 확인

# 4. 성공 페이지 재진입 테스트
# 결제 완료 후 성공 페이지에서 새로고침 → confirm 1회만 호출 (Network 탭)
# WAL 확인: Application > Local Storage > toss_sync_pos_wal → 해당 엔트리 삭제됨

# 5. 오프라인 테스트
# DevTools > Network > Offline 체크
# → 상단에 "인터넷 연결이 끊어졌습니다" 배너 표시
# → 결제 시도 → "인터넷 연결을 확인해주세요" 에러
# → Offline 해제 → 배너 사라짐 + 데이터 자동 리페치
```

---

## 파일 체크리스트

- [ ] `src/hooks/usePaymentLock.ts` — 신규
- [ ] `src/hooks/useOnlineStatus.ts` — 신규
- [ ] `src/components/common/OfflineBanner.tsx` — 신규
- [ ] `backend/app/middleware/error_handler.py` — 신규
- [ ] `src/hooks/usePayment.ts` — 수정 (잠금 + 오프라인)
- [ ] `src/app/payment/success/page.tsx` — 수정 (재진입 방지 + WAL + lock)
- [ ] `src/app/payment/fail/page.tsx` — 수정 (lock 해제)
- [ ] `backend/app/main.py` — 수정 (에러 핸들러 등록)
