# Phase 9. 결제 상태 머신 & WAL & 자동 복구

> **목표:** 브라우저 크래시, 네트워크 장애, 탭 종료 등의 상황에서 미완료 결제를 자동 복구한다. WAL(Write-Ahead Log)에 결제 인텐트를 기록하고, 상태 머신으로 플로우를 추적하며, 앱 재로드 시 RecoveryService가 자동으로 복구를 시도한다.
>
> **예상 소요:** 150~180분
>
> **선행 조건:** Phase 7 완료 (결제 플로우 동작), Phase 8 완료 (멱등성 키 생성)

---

## 왜 이 단계가 필요한가?

Phase 7에서 결제 플로우가 완성되었지만, **중간에 끊기는 경우**를 처리하지 않는다:

```
정상 플로우:
  결제하기 → 주문 생성 → Toss 결제창 → 결제 완료 → confirm → PAID ✓

문제 시나리오:
  1. 주문 생성 후 브라우저 크래시     → 주문은 있지만 결제 안 됨
  2. Toss 결제창에서 결제 후 네트워크 끊김 → 돈은 빠졌지만 confirm 안 됨
  3. confirm 요청 중 탭 종료          → 서버에서 결제는 됐지만 프론트 상태가 안 맞음
```

**문제의 핵심: 프론트엔드 상태는 메모리에 있어 휘발적이다.**

브라우저가 닫히면 "지금 어디까지 진행됐는지"를 알 수 없다. WAL은 이 문제를 해결한다:

```
WAL(Write-Ahead Log) 전략:

1. 결제 시작 전, LocalStorage에 "이런 결제를 시도하겠다"를 기록 (인텐트)
2. 각 단계를 진행할 때마다 WAL을 업데이트 (orderId, paymentKey 등)
3. 결제 완료 시 WAL 삭제
4. 만약 중간에 크래시 → WAL에 기록이 남아 있음
5. 앱 재로드 시 → WAL에 미완료 기록 발견 → 서버 상태 확인 → 자동 복구
```

### 상태 머신이 필요한 이유

결제 플로우는 여러 단계를 거치며, 각 단계에서 성공/실패/취소 분기가 있다. if-else 체인으로 관리하면:

```typescript
// ✗ if-else 체인 — 상태 전이 로직이 흩어져 있음
if (isCreatingOrder) { ... }
else if (isWaitingToss) { ... }
else if (isConfirming) { ... }
// 새 상태 추가 시 모든 분기를 확인해야 함
// 어떤 상태에서 어떤 이벤트가 가능한지 한눈에 안 보임
```

상태 머신(`useReducer`)으로 관리하면:

```typescript
// ✓ 상태 머신 — 모든 전이가 한 곳에 선언적으로 정의됨
case "TOSS_POPUP":
  if (event.type === "TOSS_SUCCESS") return "CONFIRMING";
  if (event.type === "TOSS_FAIL") return "ERROR";
  if (event.type === "USER_CANCEL") return "CANCELLED";
  return state; // 그 외 이벤트는 무시 (불가능한 전이 차단)
```

---

## 상태 전이 다이어그램

```
                      ┌─────────┐
                      │  IDLE   │  초기 상태
                      └────┬────┘
                           │ 사용자가 "결제하기" 클릭
                           ▼
                    ┌──────────────┐
              ┌─────│ WAL_WRITING  │  LocalStorage에 인텐트 기록
              │     └──────┬───────┘
              │            │ WAL 기록 성공
              │            ▼
              │     ┌──────────────┐
              │     │ORDER_CREATING│  POST /api/orders
              │     └──────┬───────┘
              │            │ 주문 생성 성공 (orderId 받음)
              │            ▼
              │     ┌──────────────┐
              │     │ TOSS_POPUP   │  Toss 결제창 열림
              │     └──────┬───────┘
              │            │
              │     ┌──────┴──────────────────────┐
              │     │                              │
              │     ▼                              ▼
              │  ┌──────────┐              ┌────────────┐
              │  │CONFIRMING│  성공 콜백    │ CANCELLED  │ 사용자가 결제창 닫음
              │  └────┬─────┘              └────────────┘
              │       │
              │       │ POST /confirm 성공
              │       ▼
              │  ┌──────────┐
              │  │   DONE   │
              │  └──────────┘
              │
              │  에러 발생 (어떤 단계에서든)
              ▼
       ┌─────────────┐
       │   ERROR     │
       └──────┬──────┘
              │
       ┌──────┴────────────────┐
       │                       │
       ▼                       ▼
┌─────────────┐         ┌───────────────┐
│  RETRYING   │ 자동재시도│NEEDS_RECOVERY │ 수동 복구 필요
│ (최대 3회)   │         │(RecoveryBanner)│
└──────┬──────┘         └───────────────┘
       │
       │ 재시도 성공 → CONFIRMING 또는 DONE
       │ 재시도 3회 실패 → NEEDS_RECOVERY
       ▼
   (위 분기 반복)
```

**10개 상태 / 11개 이벤트:**

| 상태 | 설명 | 다음 가능한 상태 |
|------|------|----------------|
| `IDLE` | 초기/대기 | `WAL_WRITING` |
| `WAL_WRITING` | WAL에 인텐트 기록 중 | `ORDER_CREATING`, `ERROR` |
| `ORDER_CREATING` | POST /api/orders 호출 중 | `TOSS_POPUP`, `ERROR` |
| `TOSS_POPUP` | Toss 결제창 열림 | `CONFIRMING`, `CANCELLED`, `ERROR` |
| `CONFIRMING` | POST /api/payments/confirm 호출 중 | `DONE`, `ERROR` |
| `DONE` | 결제 완료 (터미널) | `IDLE` (RESET) |
| `CANCELLED` | 사용자 취소 (터미널) | `IDLE` (RESET) |
| `ERROR` | 에러 발생 | `RETRYING`, `NEEDS_RECOVERY`, `IDLE` |
| `RETRYING` | 자동 재시도 중 | `DONE`, `ERROR` |
| `NEEDS_RECOVERY` | 수동 복구 필요 (터미널) | `IDLE` (RESET) |

---

## 구현 TODO

### Step 9-1. 결제 상태 머신 (타입 + 리듀서)

**파일:** `frontend/src/types/payment.ts` (신규)

상태 머신의 핵심: 상태와 이벤트 타입 정의 + 순수 함수 리듀서.

```typescript
/** 결제 플로우 10개 상태 */
export type PaymentState =
  | "IDLE"
  | "WAL_WRITING"
  | "ORDER_CREATING"
  | "TOSS_POPUP"
  | "CONFIRMING"
  | "DONE"
  | "CANCELLED"
  | "ERROR"
  | "RETRYING"
  | "NEEDS_RECOVERY";

/** 결제 플로우 이벤트 (discriminated union) */
export type PaymentEvent =
  | { type: "START_PAYMENT" }
  | { type: "WAL_WRITTEN"; walId: string }
  | { type: "ORDER_CREATED"; orderId: string }
  | { type: "TOSS_SUCCESS"; paymentKey: string; orderId: string; amount: number }
  | { type: "TOSS_FAIL"; code: string; message: string }
  | { type: "USER_CANCEL" }
  | { type: "CONFIRM_SUCCESS" }
  | { type: "CONFIRM_FAIL"; error: string }
  | { type: "RETRY" }
  | { type: "RECOVERY_NEEDED" }
  | { type: "RESET" };

/**
 * 결제 상태 머신 리듀서
 *
 * 순수 함수 — 현재 상태 + 이벤트 → 다음 상태
 * 부작용(API 호출, WAL 기록 등)은 usePayment 훅에서 처리
 */
export function paymentReducer(
  state: PaymentState,
  event: PaymentEvent
): PaymentState {
  switch (state) {
    case "IDLE":
      if (event.type === "START_PAYMENT") return "WAL_WRITING";
      return state;

    case "WAL_WRITING":
      if (event.type === "WAL_WRITTEN") return "ORDER_CREATING";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "ORDER_CREATING":
      if (event.type === "ORDER_CREATED") return "TOSS_POPUP";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "TOSS_POPUP":
      if (event.type === "TOSS_SUCCESS") return "CONFIRMING";
      if (event.type === "TOSS_FAIL") return "ERROR";
      if (event.type === "USER_CANCEL") return "CANCELLED";
      return state;

    case "CONFIRMING":
      if (event.type === "CONFIRM_SUCCESS") return "DONE";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "ERROR":
      if (event.type === "RETRY") return "RETRYING";
      if (event.type === "RECOVERY_NEEDED") return "NEEDS_RECOVERY";
      if (event.type === "RESET") return "IDLE";
      return state;

    case "RETRYING":
      if (event.type === "CONFIRM_SUCCESS") return "DONE";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "DONE":
    case "CANCELLED":
    case "NEEDS_RECOVERY":
      if (event.type === "RESET") return "IDLE";
      return state;

    default:
      return state;
  }
}
```

**왜 순수 함수 리듀서인가?**

- React의 `useReducer`에 그대로 전달 가능
- 테스트가 쉬움: `paymentReducer("IDLE", { type: "START_PAYMENT" })` → `"WAL_WRITING"` 단언
- 상태 전이 로직이 한 곳에 집중 → 새 상태 추가 시 리듀서만 수정

---

### Step 9-2. WAL Manager

**파일:** `frontend/src/services/recovery/WALManager.ts` (신규)

LocalStorage에 결제 인텐트를 기록/관리하는 클래스. 브라우저가 꺼져도 데이터가 남는다.

```typescript
import type { PaymentState } from "@/types/payment";

/** WAL 엔트리 — 하나의 결제 시도에 대한 기록 */
export interface WALEntry {
  id: string;                           // UUID v4 (WAL 내부 ID)
  orderId: string | null;               // 주문 생성 전이면 null
  paymentKey: string | null;            // Toss 결제창 전이면 null
  amount: number;                       // 결제 금액
  items: { menuId: string; quantity: number }[];  // 장바구니 스냅샷
  idempotencyKey: string;               // 멱등성 키
  state: PaymentState;                  // 현재 상태 머신 상태
  createdAt: number;                    // Date.now() — 생성 시각
  updatedAt: number;                    // Date.now() — 마지막 업데이트
}

const WAL_STORAGE_KEY = "toss_sync_pos_wal";

export class WALManager {
  /**
   * WAL에 새 인텐트 기록
   * @returns 생성된 WAL 엔트리의 ID
   */
  write(entry: Omit<WALEntry, "id" | "createdAt" | "updatedAt">): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    const entries = this.readAll();
    entries.push({ ...entry, id, createdAt: now, updatedAt: now });
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
    return id;
  }

  /**
   * 특정 WAL 엔트리 부분 업데이트
   * 주로 orderId, paymentKey, state를 단계별로 업데이트
   */
  update(id: string, patch: Partial<WALEntry>): void {
    const entries = this.readAll().map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e
    );
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }

  /** 완료된 WAL 엔트리 삭제 (결제 성공/취소 후) */
  remove(id: string): void {
    const entries = this.readAll().filter((e) => e.id !== id);
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }

  /** 모든 WAL 엔트리 읽기 */
  readAll(): WALEntry[] {
    const raw = localStorage.getItem(WAL_STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /**
   * 미완료(복구 필요) 엔트리만 조회
   * 터미널 상태(DONE, CANCELLED, IDLE)는 제외
   */
  getPending(): WALEntry[] {
    const terminal: PaymentState[] = ["DONE", "CANCELLED", "IDLE"];
    return this.readAll().filter((e) => !terminal.includes(e.state));
  }

  /**
   * 만료된 엔트리 정리 (기본 24시간)
   * 너무 오래된 WAL은 복구해도 의미 없음 → 삭제
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    const entries = this.readAll().filter((e) => e.createdAt > cutoff);
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }
}
```

**WAL의 생명주기:**

```
결제 시작:
  wal.write({ orderId: null, paymentKey: null, state: "WAL_WRITING", ... })
  → WAL ID 반환: "uuid-1234"

주문 생성 성공:
  wal.update("uuid-1234", { orderId: "ord_abc", state: "ORDER_CREATING" })

Toss 결제 성공:
  wal.update("uuid-1234", { paymentKey: "pk_xyz", state: "CONFIRMING" })

confirm 성공:
  wal.remove("uuid-1234")  ← WAL에서 삭제 (미션 완료)

만약 중간에 크래시:
  → WAL에 "uuid-1234" 기록이 남아 있음
  → 앱 재로드 시 RecoveryService가 발견하고 복구 시도
```

**왜 LocalStorage인가?**

```
IndexedDB  → 비동기 + 복잡 → POS 환경에서는 과잉
SessionStorage → 탭/브라우저 닫으면 소멸 → 복구 불가
LocalStorage → 동기 + 단순 + 브라우저 꺼져도 유지 → ✓
Cookie → 4KB 크기 제한, 서버로 매번 전송 → ✗

WAL 데이터는 보통 수백 바이트 수준이므로
LocalStorage의 5MB 용량으로 충분하다.
```

---

### Step 9-3. Recovery Service

**파일:** `frontend/src/services/recovery/RecoveryService.ts` (신규)

앱 로드 시 WAL을 스캔하여 미완료 결제를 자동 복구하는 서비스.

```typescript
import { WALManager, WALEntry } from "./WALManager";
import { api } from "../api";

/** 복구 결과 — UI에서 "N건 복구됨" 등 표시에 사용 */
export interface RecoveryResult {
  walId: string;
  orderId: string | null;
  action: "confirmed" | "cancelled" | "needs_manual" | "cleaned";
  message: string;
}

export class RecoveryService {
  private wal = new WALManager();

  /**
   * 모든 미완료 WAL 엔트리를 순회하며 복구 시도
   *
   * 1. 만료된 엔트리 정리 (24시간 이상)
   * 2. 각 미완료 엔트리에 대해 recoverOne() 호출
   * 3. 결과 배열 반환 → UI에서 RecoveryBanner로 표시
   */
  async recoverAll(): Promise<RecoveryResult[]> {
    this.wal.cleanup();
    const pending = this.wal.getPending();
    const results: RecoveryResult[] = [];

    for (const entry of pending) {
      const result = await this.recoverOne(entry);
      results.push(result);
    }
    return results;
  }

  private async recoverOne(entry: WALEntry): Promise<RecoveryResult> {
    // Case 1: 주문조차 생성되지 않은 경우
    // → 돈이 빠지지 않았으므로 WAL만 정리하면 됨
    if (!entry.orderId) {
      this.wal.remove(entry.id);
      return {
        walId: entry.id,
        orderId: null,
        action: "cleaned",
        message: "주문 미생성 — WAL 정리됨",
      };
    }

    // Case 2: orderId가 있음 → 서버에 상태 확인
    try {
      const payment = await api.get<{
        status: string;
        paymentKey: string | null;
      }>(`/api/payments/${entry.orderId}`);

      // 2a. 서버에서 이미 결제 완료 확인
      if (payment.status === "DONE") {
        this.wal.remove(entry.id);
        return {
          walId: entry.id,
          orderId: entry.orderId,
          action: "confirmed",
          message: "서버에서 결제 완료 확인됨",
        };
      }

      // 2b. 결제 진행 중 + paymentKey 있음 → confirm 재시도
      if (payment.status === "IN_PROGRESS" && entry.paymentKey) {
        try {
          await api.post("/api/payments/confirm", {
            payment_key: entry.paymentKey,
            order_id: entry.orderId,
            amount: entry.amount,
          });

          this.wal.remove(entry.id);
          return {
            walId: entry.id,
            orderId: entry.orderId,
            action: "confirmed",
            message: "결제 승인 재시도 성공",
          };
        } catch {
          // confirm 재시도 실패 → 수동 복구 필요
        }
      }

      // 2c. 그 외 → 수동 복구 필요
      this.wal.update(entry.id, { state: "NEEDS_RECOVERY" });
      return {
        walId: entry.id,
        orderId: entry.orderId,
        action: "needs_manual",
        message: `수동 확인 필요 (서버 상태: ${payment.status})`,
      };
    } catch {
      // 서버 연결 자체가 실패
      this.wal.update(entry.id, { state: "NEEDS_RECOVERY" });
      return {
        walId: entry.id,
        orderId: entry.orderId,
        action: "needs_manual",
        message: "서버 연결 실패 — 수동 확인 필요",
      };
    }
  }
}
```

**복구 로직 의사결정 트리:**

```
WAL 엔트리 발견
  │
  ├── orderId === null?
  │     └── YES → WAL 삭제 (주문 미생성, 돈 안 빠짐) → "cleaned"
  │
  └── orderId 있음 → 서버에 결제 상태 조회
        │
        ├── GET /api/payments/{orderId} → status=DONE
        │     └── 이미 완료 → WAL 삭제 → "confirmed"
        │
        ├── status=IN_PROGRESS + paymentKey 있음
        │     └── POST /api/payments/confirm 재시도
        │           ├── 성공 → WAL 삭제 → "confirmed"
        │           └── 실패 → "needs_manual"
        │
        ├── 그 외 상태 (ABORTED, READY 등)
        │     └── "needs_manual" (RecoveryBanner에서 안내)
        │
        └── 서버 연결 실패
              └── "needs_manual"
```

---

### Step 9-4. usePayment 훅 (상태 머신 + WAL 통합)

**파일:** `frontend/src/hooks/usePayment.ts` (신규)

결제 플로우 전체를 오케스트레이션하는 훅. `useReducer`로 상태 머신을 구동하고, 각 상태 전이에서 WAL 기록 + API 호출을 수행한다.

```typescript
import { useReducer, useCallback, useRef } from "react";
import { paymentReducer } from "@/types/payment";
import type { PaymentState, PaymentEvent } from "@/types/payment";
import { WALManager } from "@/services/recovery/WALManager";
import { createPaymentService } from "@/services/payment";

interface PaymentFlowParams {
  items: { menuId: string; quantity: number; name: string }[];
  amount: number;
  idempotencyKey: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  onOrderCreate: () => Promise<{ id: string; totalAmount: number }>;
}

export function usePayment() {
  const [state, dispatch] = useReducer(paymentReducer, "IDLE" as PaymentState);
  const walRef = useRef(new WALManager());
  const walIdRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);

  const MAX_RETRIES = 3;

  const startPayment = useCallback(async (params: PaymentFlowParams) => {
    const wal = walRef.current;

    try {
      // 1. WAL에 인텐트 기록
      dispatch({ type: "START_PAYMENT" });

      const walId = wal.write({
        orderId: null,
        paymentKey: null,
        amount: params.amount,
        items: params.items.map((i) => ({ menuId: i.menuId, quantity: i.quantity })),
        idempotencyKey: params.idempotencyKey,
        state: "WAL_WRITING",
      });
      walIdRef.current = walId;

      dispatch({ type: "WAL_WRITTEN", walId });

      // 2. 주문 생성
      const order = await params.onOrderCreate();
      wal.update(walId, { orderId: order.id, state: "ORDER_CREATING" });

      dispatch({ type: "ORDER_CREATED", orderId: order.id });

      // 3. Toss 결제창 열기
      wal.update(walId, { state: "TOSS_POPUP" });
      const paymentService = createPaymentService();
      await paymentService.requestPayment({
        orderId: order.id,
        orderName: params.orderName,
        amount: order.totalAmount,
        successUrl: params.successUrl,
        failUrl: params.failUrl,
      });

      // Toss SDK가 리다이렉트하므로 여기 이후 코드는 실행되지 않음
      // (success/fail 페이지에서 이어짐)

    } catch (error) {
      dispatch({
        type: "CONFIRM_FAIL",
        error: error instanceof Error ? error.message : "결제 중 오류 발생",
      });

      // 자동 재시도 로직은 confirm 단계에서만 의미 있음
      // 주문 생성 실패 등은 재시도 대상이 아님
    }
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    retryCountRef.current = 0;
    walIdRef.current = null;
  }, []);

  return {
    state,
    startPayment,
    reset,
  };
}
```

**usePayment vs 현재 구조의 차이:**

```
현재 (Phase 7):
  handleOrder → createOrder.mutate({
    onSuccess: async (order) => {
      dispatch({ type: "CLEAR" });
      paymentService.requestPayment(...)
    }
  })
  → WAL 없음, 상태 추적 없음

Phase 9 이후:
  handleOrder → usePayment().startPayment({
    onOrderCreate: () => createOrder.mutateAsync(...)
  })
  → WAL 기록, 상태 머신 추적, 크래시 복구 가능
```

---

### Step 9-5. useRecovery 훅

**파일:** `frontend/src/hooks/useRecovery.ts` (신규)

앱 로드 시 자동으로 RecoveryService를 실행하는 훅.

```typescript
import { useEffect, useState } from "react";
import { RecoveryService, RecoveryResult } from "@/services/recovery/RecoveryService";

export function useRecovery() {
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    const service = new RecoveryService();

    setIsRecovering(true);
    service
      .recoverAll()
      .then(setResults)
      .catch(console.error)
      .finally(() => setIsRecovering(false));
  }, []);

  // 수동 복구 필요한 건수
  const needsManualCount = results.filter(
    (r) => r.action === "needs_manual"
  ).length;

  // 자동 복구된 건수
  const recoveredCount = results.filter(
    (r) => r.action === "confirmed" || r.action === "cleaned"
  ).length;

  const dismiss = () => setResults([]);

  return {
    results,
    isRecovering,
    needsManualCount,
    recoveredCount,
    dismiss,
  };
}
```

**사용 위치:**

```
POSClientShell (또는 루트 레이아웃)에서:

const { needsManualCount, recoveredCount, isRecovering, dismiss } = useRecovery();

{!isRecovering && (recoveredCount > 0 || needsManualCount > 0) && (
  <RecoveryBanner
    recoveredCount={recoveredCount}
    needsManualCount={needsManualCount}
    onDismiss={dismiss}
  />
)}
```

---

### Step 9-6. RecoveryBanner 컴포넌트

**파일:** `frontend/src/components/payment/RecoveryBanner.tsx` (신규)

미완료 결제가 발견되었을 때 POS 화면 상단에 표시하는 배너.

```typescript
"use client";

import styled from "@emotion/styled";

interface RecoveryBannerProps {
  recoveredCount: number;
  needsManualCount: number;
  onDismiss: () => void;
}

const Banner = styled.div<{ variant: "success" | "warning" }>`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  background: ${({ variant, theme }) =>
    variant === "success" ? theme.colors.success : theme.colors.warning};
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
`;

const DismissButton = styled.button`
  background: rgba(255, 255, 255, 0.3);
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
`;

export default function RecoveryBanner({
  recoveredCount,
  needsManualCount,
  onDismiss,
}: RecoveryBannerProps) {
  if (needsManualCount > 0) {
    return (
      <Banner variant="warning">
        <span>수동 확인 필요: {needsManualCount}건의 미완료 결제가 있습니다</span>
        <DismissButton onClick={onDismiss}>닫기</DismissButton>
      </Banner>
    );
  }

  return (
    <Banner variant="success">
      <span>자동 복구 완료: {recoveredCount}건의 결제가 복구되었습니다</span>
      <DismissButton onClick={onDismiss}>닫기</DismissButton>
    </Banner>
  );
}
```

---

### Step 9-7. 결제 플로우에 WAL 통합 (Shell 수정)

Phase 7에서 구현한 각 Shell의 `onSuccess`를 `usePayment` 훅으로 교체한다.

**변경 패턴 (Cart.tsx 예시):**

```typescript
// Phase 7 (현재):
onSuccess: async (order) => {
  dispatch({ type: "CLEAR" });
  const paymentService = createPaymentService();
  await paymentService.requestPayment({ ... });
}

// Phase 9 (변경 후):
// usePayment 훅 사용
const { state: paymentState, startPayment } = usePayment();

const handleOrder = () => {
  if (state.items.length === 0) return;

  const firstName = state.items[0]?.menu.name || "주문";
  const orderName = state.items.length > 1
    ? `${firstName} 외 ${state.items.length - 1}건`
    : firstName;

  startPayment({
    items: state.items.map((item) => ({
      menuId: item.menu.id,
      quantity: item.quantity,
      name: item.menu.name,
    })),
    amount: state.totalAmount,
    idempotencyKey: generateIdempotencyKey(
      state.items.map((i) => ({ menuId: i.menu.id, quantity: i.quantity }))
    ),
    orderName,
    successUrl: "/payment/success?returnTo=/",
    failUrl: "/payment/fail?returnTo=/",
    onOrderCreate: async () => {
      const order = await createOrder.mutateAsync({
        items: state.items.map((item) => ({
          menu_id: item.menu.id,
          quantity: item.quantity,
        })),
        idempotency_key: idempotencyKey,
        order_mode: state.orderMode,
      });
      dispatch({ type: "CLEAR" });
      return order;
    },
  });
};
```

---

### Step 9-8. recovery/index.ts 배럴 파일

**파일:** `frontend/src/services/recovery/index.ts` (신규)

```typescript
export { WALManager } from "./WALManager";
export type { WALEntry } from "./WALManager";
export { RecoveryService } from "./RecoveryService";
export type { RecoveryResult } from "./RecoveryService";
```

---

## 검증 체크리스트

### 1. 상태 머신 단위 테스트 (수동)

```typescript
// 브라우저 Console에서:
import { paymentReducer } from "@/types/payment";

// 정상 플로우:
paymentReducer("IDLE", { type: "START_PAYMENT" })           // → "WAL_WRITING"
paymentReducer("WAL_WRITING", { type: "WAL_WRITTEN", walId: "x" })  // → "ORDER_CREATING"
paymentReducer("ORDER_CREATING", { type: "ORDER_CREATED", orderId: "o" }) // → "TOSS_POPUP"
paymentReducer("TOSS_POPUP", { type: "TOSS_SUCCESS", ... })  // → "CONFIRMING"
paymentReducer("CONFIRMING", { type: "CONFIRM_SUCCESS" })    // → "DONE"

// 불가능한 전이 차단:
paymentReducer("IDLE", { type: "CONFIRM_SUCCESS" })          // → "IDLE" (무시)
paymentReducer("DONE", { type: "START_PAYMENT" })            // → "DONE" (무시)
```

### 2. WAL 기록/삭제 확인

```
1. POS에서 메뉴 선택 → 결제하기
2. DevTools → Application → LocalStorage → toss_sync_pos_wal
   → WAL 엔트리가 기록되어 있어야 함
3. 결제 완료 후 → WAL이 비어 있어야 함
```

### 3. 크래시 복구 테스트

```
1. POS에서 메뉴 선택 → 결제하기 (주문 생성까지만)
2. Toss 결제창이 뜨기 전에 페이지 강제 새로고침 (F5)
3. 페이지 재로드 시:
   - RecoveryBanner가 표시되어야 함
   - WAL에 남아있는 미완료 엔트리가 자동 처리됨
   - orderId가 없으면 → "cleaned" (WAL 삭제)
   - orderId가 있으면 → 서버 상태 확인 후 적절한 액션
```

### 4. 빌드 검증

```bash
cd frontend && npm run build    # 타입 + 빌드 에러 없음
```

---

## 구현할 파일 정리

| # | 파일 | 유형 | 설명 |
|---|------|------|------|
| 1 | `frontend/src/types/payment.ts` | 신규 | PaymentState(10), PaymentEvent(11), paymentReducer |
| 2 | `frontend/src/services/recovery/WALManager.ts` | 신규 | LocalStorage WAL — write/update/remove/readAll/getPending/cleanup |
| 3 | `frontend/src/services/recovery/RecoveryService.ts` | 신규 | 미완료 WAL 순회 → 서버 상태 확인 → 자동 복구 |
| 4 | `frontend/src/services/recovery/index.ts` | 신규 | 배럴 파일 (re-export) |
| 5 | `frontend/src/hooks/usePayment.ts` | 신규 | 상태 머신 + WAL + 결제 플로우 오케스트레이션 |
| 6 | `frontend/src/hooks/useRecovery.ts` | 신규 | 앱 로드 시 자동 복구 실행 |
| 7 | `frontend/src/components/payment/RecoveryBanner.tsx` | 신규 | 복구 결과 배너 UI |
| 8 | `frontend/src/components/pos/Cart.tsx` | 수정 | usePayment 훅으로 결제 플로우 교체 |
| 9 | `frontend/src/components/kiosk/KioskShell.tsx` | 수정 | usePayment 훅으로 결제 플로우 교체 |
| 10 | `frontend/src/components/order/TableOrderShell.tsx` | 수정 | usePayment 훅으로 결제 플로우 교체 |
| 11 | `frontend/src/components/pos/POSClientShell.tsx` | 수정 | useRecovery + RecoveryBanner 추가 |

---

## 다음 단계

→ **Phase 10**: 웹훅 핸들러. Toss에서 결제 상태 변경 시 서버로 비동기 알림(webhook)을 전송한다. 서명 검증, 중복 방지, 이벤트 기록을 처리하여 서버 측 데이터 정합성을 보장한다.
