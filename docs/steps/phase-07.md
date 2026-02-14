# Phase 7. 프론트엔드 — 결제 추상화 & 결제 플로우 페이지

> **목표:** Strategy 패턴으로 결제 추상화 (Mock/Toss 전환) → POS/키오스크/테이블오더 공통 결제 페이지 구현 → 결제 성공/실패 처리
>
> **예상 소요:** 120~150분
>
> **선행 조건:** Phase 5 완료 (POS/키오스크/테이블오더 UI), Phase 6 완료 (백엔드 결제 API)

---

## 왜 이 단계가 필요한가?

Phase 5에서 "결제하기"/"주문하기" 버튼을 누르면 `POST /api/orders`로 주문을 생성하고 장바구니를 비운다. 하지만 **실제 결제**는 이루어지지 않는다 — 주문이 `PENDING` 상태에 머물러 있다.

이 단계에서 **Toss Payments SDK**를 연동하여 실제 결제 플로우를 완성한다:

```
현재 (Phase 5):
  메뉴 선택 → 장바구니 → "결제하기" → POST /api/orders → 끝 (PENDING)

Phase 7 이후:
  메뉴 선택 → 장바구니 → "결제하기"
    → POST /api/orders → Toss 결제창 → 고객 카드 결제
    → /payment/success → POST /api/payments/confirm → PAID ✓
```

### Strategy 패턴을 쓰는 이유

개발 중에 매번 실제 Toss 결제창을 띄울 수 없다:

- 테스트 카드 정보를 매번 입력해야 함
- 네트워크가 불안정하면 개발이 중단됨
- CI/CD에서 E2E 테스트 불가

**Strategy 패턴**으로 결제 인터페이스를 추상화하면:

```
NEXT_PUBLIC_PAYMENT_MOCK="true"   → MockPaymentStrategy  (즉시 성공/실패)
NEXT_PUBLIC_PAYMENT_MOCK="false"  → TossPaymentStrategy  (실제 Toss SDK)
```

개발 중에는 Mock, 실제 테스트/배포 시에는 Toss — 코드 변경 없이 환경변수로 전환.

### 다중 제품 결제 플로우

POS, 키오스크, 테이블오더 모두 **동일한 결제 파이프라인**을 공유한다:

```
POS (/)           ──→ 주문 생성 ──→ 결제 요청 ──→ /payment/success ──→ POS로 복귀
키오스크 (/kiosk)  ──→ 주문 생성 ──→ 결제 요청 ──→ /payment/success ──→ 키오스크 복귀
테이블오더 (/order/1)──→ 주문 생성 ──→ 결제 요청 ──→ /payment/success ──→ 테이블오더 복귀
```

**제품별 차이점은 `returnTo` URL 파라미터로 처리:**

| 제품       | successUrl                           | failUrl                           |
| ---------- | ------------------------------------ | --------------------------------- |
| POS        | `/payment/success?returnTo=/`        | `/payment/fail?returnTo=/`        |
| 키오스크   | `/payment/success?returnTo=/kiosk`   | `/payment/fail?returnTo=/kiosk`   |
| 테이블오더 | `/payment/success?returnTo=/order/1` | `/payment/fail?returnTo=/order/1` |

---

## 구현 TODO

### Step 7-1. 결제 서비스 인터페이스

**파일:** `frontend/src/services/payment/PaymentService.ts`

모든 결제 구현체가 따라야 하는 인터페이스를 정의한다.

```typescript
/**
 * 결제 요청 파라미터
 */
export interface PaymentRequest {
  orderId: string;
  orderName: string; // "아메리카노 외 2건" — Toss 결제창에 표시
  amount: number; // 원 단위
  successUrl: string; // 결제 성공 시 리다이렉트 URL
  failUrl: string; // 결제 실패 시 리다이렉트 URL
}

/**
 * 결제 승인 확인 파라미터 (successUrl에서 추출한 값)
 */
export interface PaymentConfirmation {
  paymentKey: string; // Toss가 발급한 결제 키
  orderId: string;
  amount: number;
}

/**
 * 결제 처리 결과
 */
export interface PaymentResult {
  success: boolean;
  paymentKey?: string;
  status: string; // DONE, CANCELED, ABORTED 등
  message?: string; // 에러 메시지 (실패 시)
}

/**
 * 결제 서비스 인터페이스
 *
 * TossPaymentStrategy와 MockPaymentStrategy가 이 인터페이스를 구현한다.
 * createPaymentService() 팩토리로 환경변수에 따라 적절한 구현체를 선택.
 */

/*
  interface PaymentService          ← "결제 서비스는 이 4개 메서드를 반드시 가져야 한다"                                                                    
  │                                                                                                                                                         
  ├── TossPaymentStrategy          ← 실제 Toss SDK로 결제 (운영용)
  │   ├── requestPayment()  → Toss 결제창 팝업 <함수>
  │   ├── confirmPayment()  → 서버 → Toss confirm API <함수>
  │   ├── cancelPayment()   → 서버 → Toss cancel API <함수>
  │   └── getStatus()       → 서버 DB 조회 <함수>
  │
  └── MockPaymentStrategy          ← 가짜 결제 (개발/테스트용)
      ├── requestPayment()  → 즉시 successUrl로 리다이렉트
      ├── confirmPayment()  → 무조건 성공 반환
      ├── cancelPayment()   → 무조건 성공 반환
      └── getStatus()       → 무조건 DONE 반환
*/
export interface PaymentService {
  /** 결제창 호출 (Toss SDK) 또는 Mock 리다이렉트 */
  requestPayment(request: PaymentRequest): Promise<void>;

  /** 결제 승인 확인 — 백엔드 POST /api/payments/confirm 호출 */
  confirmPayment(confirmation: PaymentConfirmation): Promise<PaymentResult>;

  /** 결제 취소 — 백엔드 POST /api/payments/{orderId}/cancel 호출 */
  cancelPayment(orderId: string, reason: string): Promise<PaymentResult>;

  /** 결제 상태 조회 — 백엔드 GET /api/payments/{orderId} 호출 */
  getStatus(orderId: string): Promise<PaymentResult>;
}
```

**왜 `requestPayment`이 `Promise<void>`인가?**

`requestPayment`는 Toss 결제창을 **브라우저에 띄우는** 액션이다. 사용자가 결제를 완료하면 Toss가 `successUrl`로 **리다이렉트**하므로, 이 함수 자체는 리턴하지 않는다 (페이지가 바뀜). Mock 구현에서도 `window.location.href`로 리다이렉트하여 동일한 흐름을 시뮬레이션한다.

---

### Step 7-2. Toss 구현체

**파일:** `frontend/src/services/payment/TossPaymentStrategy.ts`

실제 Toss Payments SDK를 사용하는 구현체.

```typescript
import { loadTossPayments } from "@tosspayments/payment-sdk";
import type {
  PaymentService,
  PaymentRequest,
  PaymentConfirmation,
  PaymentResult,
} from "./PaymentService";
import { api } from "@/services/api";

const TOSS_CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!;

export class TossPaymentStrategy implements PaymentService {
  /**
   * Toss 결제창 호출
   *
   * 1. loadTossPayments() — Toss SDK 로드 (비동기)
   * 2. toss.requestPayment("카드", { ... }) — 결제창 실행
   * 3. 성공 → successUrl로 리다이렉트 (paymentKey, orderId, amount 파라미터)
   * 4. 실패 → failUrl로 리다이렉트 (code, message 파라미터)
   *
   * 이 함수는 리다이렉트로 페이지가 바뀌므로 resolve되지 않는다.
   */
  async requestPayment(req: PaymentRequest): Promise<void> {
    const toss = await loadTossPayments(TOSS_CLIENT_KEY);
    await toss.requestPayment("카드", {
      amount: req.amount,
      orderId: req.orderId,
      orderName: req.orderName,
      successUrl: `${window.location.origin}${req.successUrl}`,
      failUrl: `${window.location.origin}${req.failUrl}`,
    });
  }

  /**
   * 결제 승인 확인 — 백엔드 /api/payments/confirm 호출
   */
  async confirmPayment(conf: PaymentConfirmation): Promise<PaymentResult> {
    try {
      const res = await api.post<{ status: string; paymentKey: string }>(
        "/api/payments/confirm",
        {
          payment_key: conf.paymentKey,
          order_id: conf.orderId,
          amount: conf.amount,
        },
      );
      return {
        success: res.status === "DONE",
        paymentKey: res.paymentKey,
        status: res.status,
      };
    } catch (err: unknown) {
      const error = err as { detail?: string; status?: number };
      return {
        success: false,
        status: "ABORTED",
        message: error.detail || "결제 승인 실패",
      };
    }
  }

  /**
   * 결제 취소 — 백엔드 /api/payments/{orderId}/cancel 호출
   */
  async cancelPayment(orderId: string, reason: string): Promise<PaymentResult> {
    try {
      const res = await api.post<{ status: string }>(
        `/api/payments/${orderId}/cancel`,
        { reason },
      );
      return { success: true, status: res.status };
    } catch (err: unknown) {
      const error = err as { detail?: string };
      return {
        success: false,
        status: "ERROR",
        message: error.detail || "결제 취소 실패",
      };
    }
  }

  /**
   * 결제 상태 조회 — 백엔드 GET /api/payments/{orderId}
   */
  async getStatus(orderId: string): Promise<PaymentResult> {
    try {
      const res = await api.get<{ status: string; paymentKey: string | null }>(
        `/api/payments/${orderId}`,
      );
      return {
        success: res.status === "DONE",
        paymentKey: res.paymentKey ?? undefined,
        status: res.status,
      };
    } catch {
      return { success: false, status: "ERROR", message: "조회 실패" };
    }
  }
}
```

**`loadTossPayments` 동작:**

```
1. Toss SDK 스크립트를 동적으로 <script> 태그로 로드
2. SDK 초기화 후 toss 인스턴스 반환
3. toss.requestPayment()로 결제창(팝업/리다이렉트) 실행
4. 사용자가 결제 수단 선택 → 카드사 인증 → 성공/실패 판정
5. successUrl 또는 failUrl로 리다이렉트
```

---

### Step 7-3. Mock 구현체

**파일:** `frontend/src/services/payment/MockPaymentStrategy.ts`

개발/테스트용 Mock 결제. Toss 결제창 대신 즉시 successUrl로 리다이렉트한다.

```typescript
import type {
  PaymentService,
  PaymentRequest,
  PaymentConfirmation,
  PaymentResult,
} from "./PaymentService";
import { api } from "@/services/api";

export class MockPaymentStrategy implements PaymentService {
  private shouldFail: boolean;

  constructor(options?: { shouldFail?: boolean }) {
    this.shouldFail = options?.shouldFail ?? false;
  }

  /**
   * Mock 결제 요청 — Toss 결제창 대신 즉시 리다이렉트
   *
   * mock paymentKey를 생성하고 successUrl로 리다이렉트한다.
   * shouldFail=true면 failUrl로 리다이렉트.
   */
  async requestPayment(req: PaymentRequest): Promise<void> {
    if (this.shouldFail) {
      const params = new URLSearchParams({
        code: "MOCK_ERROR",
        message: "Mock 결제 실패 시뮬레이션",
      });
      window.location.href = `${req.failUrl}?${params}`;
      return;
    }

    const params = new URLSearchParams({
      paymentKey: `mock_pk_${Date.now()}`,
      orderId: req.orderId,
      amount: String(req.amount),
    });
    window.location.href = `${req.successUrl}?${params}`;
  }

  /**
   * Mock 결제 승인 — 서버의 confirm API를 그대로 호출
   *
   * Mock이라도 서버에 Payment 레코드가 생성되어야 주문 상태가 PAID로 변경된다.
   * 다만 Toss confirm API 호출은 실패할 수 있으므로(mock paymentKey),
   * 서버 에러 시 직접 상태를 업데이트하는 fallback이 필요할 수 있다.
   */
  async confirmPayment(conf: PaymentConfirmation): Promise<PaymentResult> {
    if (this.shouldFail) {
      return { success: false, status: "ABORTED", message: "Mock 실패" };
    }

    // Mock 모드에서도 백엔드 confirm API를 호출 시도
    // Toss API가 mock paymentKey를 거부할 수 있으므로 에러 시 성공으로 처리
    try {
      const res = await api.post<{ status: string; paymentKey: string }>(
        "/api/payments/confirm",
        {
          payment_key: conf.paymentKey,
          order_id: conf.orderId,
          amount: conf.amount,
        },
      );
      return {
        success: res.status === "DONE",
        paymentKey: res.paymentKey,
        status: res.status,
      };
    } catch {
      // Toss API가 mock key를 거부 → 그래도 UI상 성공 처리
      return {
        success: true,
        paymentKey: conf.paymentKey,
        status: "DONE",
        message: "Mock 결제 승인 (Toss API 미호출)",
      };
    }
  }

  async cancelPayment(
    _orderId: string,
    _reason: string,
  ): Promise<PaymentResult> {
    return { success: true, status: "CANCELED" };
  }

  async getStatus(orderId: string): Promise<PaymentResult> {
    return {
      success: true,
      paymentKey: `mock_pk_${orderId}`,
      status: "DONE",
    };
  }
}
```

**Mock vs Toss 비교:**

| 항목             | TossPaymentStrategy  | MockPaymentStrategy                |
| ---------------- | -------------------- | ---------------------------------- |
| `requestPayment` | Toss SDK 결제창 호출 | 즉시 successUrl 리다이렉트         |
| `confirmPayment` | 서버 → Toss confirm  | 서버 호출 시도 → 실패 시 성공 반환 |
| `cancelPayment`  | 서버 → Toss cancel   | 즉시 성공 반환                     |
| `getStatus`      | 서버에서 DB 조회     | 즉시 DONE 반환                     |

---

### Step 7-4. 팩토리 — 환경변수로 구현체 선택

**파일:** `frontend/src/services/payment/index.ts`

```typescript
import type { PaymentService } from "./PaymentService";
import { TossPaymentStrategy } from "./TossPaymentStrategy";
import { MockPaymentStrategy } from "./MockPaymentStrategy";

/**
 * 환경변수에 따라 결제 서비스 구현체를 선택
 *
 * NEXT_PUBLIC_PAYMENT_MOCK="true"  → Mock (개발/테스트)
 * NEXT_PUBLIC_PAYMENT_MOCK="false" → Toss (실제 결제)
 */
export function createPaymentService(): PaymentService {
  if (process.env.NEXT_PUBLIC_PAYMENT_MOCK === "true") {
    return new MockPaymentStrategy();
  }
  return new TossPaymentStrategy();
}

// 타입 재export
export type { PaymentService } from "./PaymentService";
export type {
  PaymentRequest,
  PaymentConfirmation,
  PaymentResult,
} from "./PaymentService";
```

**사용법:**

```typescript
import { createPaymentService } from "@/services/payment";

const paymentService = createPaymentService();
// → Mock or Toss (환경변수에 따라 자동 선택)

await paymentService.requestPayment({
  orderId: "cuid123",
  orderName: "아메리카노 외 2건",
  amount: 14000,
  successUrl: "/payment/success?returnTo=/",
  failUrl: "/payment/fail?returnTo=/",
});
```

---

### Step 7-5. 결제 성공 페이지

**파일:** `frontend/src/app/payment/success/page.tsx`

Toss 결제창 또는 Mock이 리다이렉트한 후 도착하는 페이지. URL 파라미터에서 결제 정보를 추출하여 서버에 confirm을 요청한다.

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import styled from "@emotion/styled";
import { createPaymentService } from "@/services/payment";
import Button from "@/components/common/Button";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Icon = styled.div<{ success: boolean }>`
  font-size: 48px;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: ${({ success, theme }) =>
    success ? `${theme.colors.success}20` : `${theme.colors.danger}20`};
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const Message = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
`;

type Status = "loading" | "success" | "error";

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const paymentKey = searchParams.get("paymentKey");
  const orderId = searchParams.get("orderId");
  const amount = searchParams.get("amount");
  const returnTo = searchParams.get("returnTo") || "/";

  useEffect(() => {
    if (!paymentKey || !orderId || !amount) {
      setStatus("error");
      setErrorMessage("결제 정보가 올바르지 않습니다.");
      return;
    }

    const confirm = async () => {
      const paymentService = createPaymentService();
      const result = await paymentService.confirmPayment({
        paymentKey,
        orderId,
        amount: Number(amount),
      });

      if (result.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMessage(result.message || "결제 승인에 실패했습니다.");
      }
    };

    confirm();
  }, [paymentKey, orderId, amount]);

  return (
    <Container>
      {status === "loading" && (
        <>
          <Title>결제 처리 중...</Title>
          <Message>잠시만 기다려주세요.</Message>
        </>
      )}

      {status === "success" && (
        <>
          <Icon success={true}>✓</Icon>
          <Title>결제가 완료되었습니다</Title>
          <Message>주문이 정상적으로 처리되었습니다.</Message>
          <Button
            variant="primary"
            size="lg"
            onClick={() => router.push(returnTo)}
          >
            돌아가기
          </Button>
        </>
      )}

      {status === "error" && (
        <>
          <Icon success={false}>✕</Icon>
          <Title>결제 승인 실패</Title>
          <Message>{errorMessage}</Message>
          <Button
            variant="primary"
            size="lg"
            onClick={() => router.push(returnTo)}
          >
            돌아가기
          </Button>
        </>
      )}
    </Container>
  );
}
```

**결제 성공 페이지 흐름:**

```
URL: /payment/success?paymentKey=pk_test_abc&orderId=cuid123&amount=14000&returnTo=/

1. useSearchParams()로 파라미터 추출
2. useEffect에서 paymentService.confirmPayment() 호출
3. 백엔드 POST /api/payments/confirm 실행
4. 성공 → "결제가 완료되었습니다" + "돌아가기" 버튼
5. 실패 → "결제 승인 실패" + 에러 메시지
6. "돌아가기" 클릭 → returnTo 경로로 이동 (POS: /, 키오스크: /kiosk 등)
```

---

### Step 7-6. 결제 실패 페이지

**파일:** `frontend/src/app/payment/fail/page.tsx`

Toss 결제창에서 사용자가 결제를 취소하거나, 카드사 인증에 실패한 경우 도착하는 페이지.

```tsx
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import styled from "@emotion/styled";
import Button from "@/components/common/Button";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Icon = styled.div`
  font-size: 48px;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: ${({ theme }) => `${theme.colors.danger}20`};
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const Message = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
`;

const ErrorCode = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.disabled};
`;

export default function PaymentFailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const code = searchParams.get("code") || "UNKNOWN";
  const message = searchParams.get("message") || "결제가 취소되었습니다.";
  const returnTo = searchParams.get("returnTo") || "/";

  return (
    <Container>
      <Icon>✕</Icon>
      <Title>결제 실패</Title>
      <Message>{message}</Message>
      <ErrorCode>에러 코드: {code}</ErrorCode>
      <Button variant="primary" size="lg" onClick={() => router.push(returnTo)}>
        돌아가기
      </Button>
    </Container>
  );
}
```

**Toss가 failUrl에 전달하는 파라미터:**

| 파라미터  | 설명        | 예시                                          |
| --------- | ----------- | --------------------------------------------- |
| `code`    | 에러 코드   | `PAY_PROCESS_CANCELED`, `REJECT_CARD_COMPANY` |
| `message` | 에러 메시지 | "사용자가 결제를 취소했습니다"                |
| `orderId` | 주문 ID     | `cuid123`                                     |

---

### Step 7-7. 각 제품에서 결제 플로우 연결

Phase 5에서 만든 Cart/KioskShell/TableOrderShell의 `handleOrder` 함수를 수정하여, 주문 생성 후 결제 플로우로 진입하도록 한다.

#### POS — Cart.tsx 수정

**파일:** `frontend/src/components/pos/Cart.tsx`

기존 `handleOrder`를 수정하여 주문 생성 성공 시 결제 요청을 추가한다.

```typescript
// 기존 import에 추가
import { createPaymentService } from "@/services/payment";

// handleOrder 수정
const handleOrder = () => {
  if (state.items.length === 0) return;

  const idempotencyKey = `pos_temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  createOrder.mutate(
    {
      items: state.items.map((item) => ({
        menu_id: item.menu.id,
        quantity: item.quantity,
      })),
      idempotency_key: idempotencyKey,
      order_mode: state.orderMode,
    },
    {
      onSuccess: async (order) => {
        dispatch({ type: "CLEAR" });

        // 주문명 생성: "아메리카노 외 2건"
        const firstName = state.items[0]?.menu.name || "주문";
        const orderName =
          state.items.length > 1
            ? `${firstName} 외 ${state.items.length - 1}건`
            : firstName;

        const paymentService = createPaymentService();
        await paymentService.requestPayment({
          orderId: order.id,
          orderName,
          amount: order.totalAmount,
          successUrl: `/payment/success?returnTo=/`,
          failUrl: `/payment/fail?returnTo=/`,
        });
      },
    },
  );
};
```

**주의:** `onSuccess` 콜백이 `order` 응답 객체를 받아야 한다. Phase 5의 `useCreateOrder` 훅이 `OrderResponse`를 반환하도록 이미 설정되어 있으므로, 콜백에서 `order.id`와 `order.totalAmount`를 사용할 수 있다.

#### 키오스크 — KioskShell.tsx 수정

동일한 패턴으로 `handleOrder` 수정. `returnTo`만 `/kiosk`로 변경.

```typescript
onSuccess: async (order) => {
  dispatch({ type: "CLEAR" });

  const firstName = state.items[0]?.menu.name || "주문";
  const orderName =
    state.items.length > 1
      ? `${firstName} 외 ${state.items.length - 1}건`
      : firstName;

  const paymentService = createPaymentService();
  await paymentService.requestPayment({
    orderId: order.id,
    orderName,
    amount: order.totalAmount,
    successUrl: `/payment/success?returnTo=/kiosk`,
    failUrl: `/payment/fail?returnTo=/kiosk`,
  });
},
```

#### 테이블오더 — TableOrderShell.tsx 수정

`returnTo`를 `/order/${tableId}`로 설정.

```typescript
onSuccess: async (order) => {
  dispatch({ type: "CLEAR" });

  const firstName = state.items[0]?.menu.name || "주문";
  const orderName =
    state.items.length > 1
      ? `${firstName} 외 ${state.items.length - 1}건`
      : firstName;

  const paymentService = createPaymentService();
  await paymentService.requestPayment({
    orderId: order.id,
    orderName,
    amount: order.totalAmount,
    successUrl: `/payment/success?returnTo=/order/${tableId}`,
    failUrl: `/payment/fail?returnTo=/order/${tableId}`,
  });
},
```

---

### Step 7-8. useCreateOrder 훅 수정 — onSuccess 콜백에 order 전달

Phase 5의 `useCreateOrder`에서 `onSuccess`가 `queryClient.invalidateQueries`만 호출한다. Step 7-7에서 `onSuccess: (order) => {...}`를 사용하려면, mutation의 `onSuccess`에서 `invalidateQueries`를 유지하면서 **외부 콜백에서도 order 데이터에 접근**할 수 있어야 한다.

현재 코드는 이미 `useMutation<OrderResponse, ...>`로 타입이 지정되어 있으므로, `mutate`의 두 번째 인자 `onSuccess`에서 order를 받을 수 있다:

```typescript
// useCreateOrder.ts 내부의 onSuccess는 캐시 무효화만 담당
onSuccess: (() => {
  queryClient.invalidateQueries({ queryKey: ["orders"] });
},
  // Cart.tsx 등에서 mutate 호출 시 추가 onSuccess는 mutation level과 합쳐진다
  createOrder.mutate(body, {
    onSuccess: (order) => {
      // order는 OrderResponse 타입 — useMutation의 첫 번째 제네릭
      // 이 콜백은 useCreateOrder 내부 onSuccess 이후에 실행됨
    },
  }));
```

React-Query의 `mutate(variables, { onSuccess })` 콜백은 mutation 정의의 `onSuccess`와 **모두 실행**된다 (덮어쓰지 않음). 따라서 기존 코드 수정 없이 동작한다.

---

## 생성/수정 파일 정리

### 신규 생성 (4개)

| #   | 파일                                          | 설명                   |
| --- | --------------------------------------------- | ---------------------- |
| 1   | `src/services/payment/PaymentService.ts`      | 결제 인터페이스 정의   |
| 2   | `src/services/payment/TossPaymentStrategy.ts` | Toss SDK 구현체        |
| 3   | `src/services/payment/MockPaymentStrategy.ts` | Mock 구현체            |
| 4   | `src/services/payment/index.ts`               | 팩토리 + 타입 재export |

### 수정 (5개)

| #   | 파일                                       | 변경 내용                                         |
| --- | ------------------------------------------ | ------------------------------------------------- |
| 5   | `src/app/payment/success/page.tsx`         | Phase 4 스텁 → confirmPayment + 결과 표시로 교체  |
| 6   | `src/app/payment/fail/page.tsx`            | Phase 4 스텁 → 에러 메시지 표시 + 돌아가기로 교체 |
| 7   | `src/components/pos/Cart.tsx`              | handleOrder에 결제 플로우 추가                    |
| 8   | `src/components/kiosk/KioskShell.tsx`      | handleOrder에 결제 플로우 추가                    |
| 9   | `src/components/order/TableOrderShell.tsx` | handleOrder에 결제 플로우 추가                    |

---

## 검증 체크리스트

```bash
cd frontend && npm run build    # 타입 + 빌드 에러 없음
```

### Mock 모드 테스트 (`NEXT_PUBLIC_PAYMENT_MOCK="true"`)

```bash
# 1. POS 결제 플로우
# localhost:3000 → 메뉴 선택 → 장바구니 → "결제하기"
# → 주문 생성 (POST /api/orders)
# → 즉시 /payment/success?paymentKey=mock_pk_...&orderId=...&amount=...&returnTo=/
# → "결제가 완료되었습니다" 또는 Mock confirm 결과
# → "돌아가기" → POS 메인으로 복귀

# 2. 키오스크 결제 플로우
# localhost:3000/kiosk → 메뉴 선택 → "주문하기"
# → /payment/success?...&returnTo=/kiosk
# → "돌아가기" → 키오스크로 복귀

# 3. 테이블오더 결제 플로우
# localhost:3000/order/1 → 메뉴 선택 → "주문하기"
# → /payment/success?...&returnTo=/order/1
# → "돌아가기" → 테이블오더로 복귀

# 4. 결제 실패 시
# MockPaymentStrategy({ shouldFail: true })로 변경하면
# → /payment/fail?code=MOCK_ERROR&message=...&returnTo=/
# → "결제 실패" + 에러 메시지 + "돌아가기"
```

### Toss 실제 테스트 (`NEXT_PUBLIC_PAYMENT_MOCK="false"`)

```bash
# .env.local:
# NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_실제키"
# NEXT_PUBLIC_PAYMENT_MOCK="false"
# backend/.env:
# TOSS_SECRET_KEY="test_sk_실제키"

# 1. POS → 결제하기 → Toss 결제창 팝업
# 2. 테스트 카드: 4330-0000-0000-0880, 유효기간 미래, CVC 아무거나
# 3. 결제 완료 → /payment/success → confirm 성공 → PAID
# 4. curl http://localhost:8000/api/orders → 해당 주문 status="PAID" 확인
```

---

## 다음 단계

→ **Phase 8**: 멱등성 보장 (프론트 + 백). Phase 7까지 결제가 동작하지만, 네트워크 장애로 같은 요청이 2번 가면 중복 결제가 될 수 있다. 프론트에서 멱등성 키를 생성하고, 백엔드 미들웨어에서 중복 요청을 감지하여 동일 응답을 반환한다.
