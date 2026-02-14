# 결제 팝업 취소 시 상태 멈춤 버그 — 분석 및 해결

## 1. 증상

```
1. "결제하기" 버튼 클릭
2. Toss 결제 모달(팝업)이 열림
3. 모달을 닫거나 결제를 취소
4. 버튼이 "결제 진행 중..." 상태로 고정 (클릭 불가)
5. 페이지를 새로고침해야만 복구됨
```

---

## 2. 관련 코드 구조

이 버그를 이해하려면 3개의 파일이 핵심이다:

```
src/
├── types/payment.ts          ← 상태 머신 (paymentReducer)
├── hooks/usePayment.ts       ← 결제 플로우 오케스트레이터
└── components/pos/Cart.tsx   ← UI (버튼 활성/비활성 제어)
```

### Cart.tsx의 버튼 제어 로직

```typescript
const { state: paymentState, startPayment } = usePayment();

const isProcessing = createOrder.isPending || paymentState !== "IDLE";
//                                            ^^^^^^^^^^^^^^^^^^^^^^^^^
//                                            IDLE이 아니면 무조건 비활성화

<Button disabled={state.items.length === 0 || isProcessing}>
  {isProcessing ? "결제 진행 중..." : "결제하기"}
</Button>
```

**핵심:** `paymentState`가 `IDLE`이 아닌 상태에 머물면 버튼은 영원히 비활성화된다.

---

## 3. 버그 발생 흐름 (수정 전)

### 3-1. 정상적인 결제 완료 흐름

```
┌──────────────────────────────────────────────────────────────────┐
│                    정상 결제 완료 흐름                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  사용자 행동          dispatch()           paymentState           │
│  ─────────────       ──────────────       ──────────────         │
│                                                                  │
│  "결제하기" 클릭  →  START_PAYMENT    →   IDLE                   │
│                                           ↓                      │
│  WAL 기록 완료    →  WAL_WRITTEN      →   WAL_WRITING            │
│                                           ↓                      │
│  주문 생성 완료   →  ORDER_CREATED    →   ORDER_CREATING         │
│                                           ↓                      │
│  Toss SDK 호출    →  (리다이렉트)     →   TOSS_POPUP             │
│                                           ↓                      │
│  ──── 브라우저가 Toss 결제 페이지로 이동 ────                     │
│  ──── 결제 완료 후 /payment/success로 리다이렉트 ────            │
│                                                                  │
│  (success 페이지에서 별도 confirm 처리)                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3-2. 팝업 취소 시 버그 흐름

Toss SDK의 `requestPayment()`는 두 가지 경로가 있다:
- **정상:** 브라우저를 Toss 결제 페이지로 리다이렉트
- **취소:** 사용자가 초기 모달을 닫으면 Promise가 reject

```
┌──────────────────────────────────────────────────────────────────┐
│                  ❌ 팝업 취소 시 버그 흐름                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  사용자 행동          dispatch()           paymentState           │
│  ─────────────       ──────────────       ──────────────         │
│                                                                  │
│  "결제하기" 클릭  →  START_PAYMENT    →   IDLE                   │
│                                           ↓                      │
│  WAL 기록 완료    →  WAL_WRITTEN      →   WAL_WRITING            │
│                                           ↓                      │
│  주문 생성 완료   →  ORDER_CREATED    →   ORDER_CREATING         │
│                                           ↓                      │
│  Toss SDK 호출    →  (모달 표시)      →   TOSS_POPUP             │
│                                           ↓                      │
│  사용자가 모달 닫기  →  Promise reject  →  catch 블록 실행       │
│                                           ↓                      │
│  catch 블록       →  CONFIRM_FAIL     →   TOSS_POPUP ← ❌ 변화없음!
│                                           ↓                      │
│                                         (멈춤)                   │
│                                           ↓                      │
│  Cart.tsx: paymentState !== "IDLE"  →  버튼 비활성화 유지        │
│                                                                  │
│  ═══════════════════════════════════════════════════════          │
│  ❌ "결제 진행 중..." 영원히 표시                                 │
│  ❌ 버튼 클릭 불가                                                │
│  ❌ 새로고침 외 복구 방법 없음                                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 근본 원인 분석

### 4-1. 상태 머신 전이 테이블 (수정 전)

```
┌─────────────────┬───────────────┬────────────────┐
│ 현재 상태        │ 수신 이벤트    │ 다음 상태       │
├─────────────────┼───────────────┼────────────────┤
│ IDLE            │ START_PAYMENT │ WAL_WRITING    │
├─────────────────┼───────────────┼────────────────┤
│ WAL_WRITING     │ WAL_WRITTEN   │ ORDER_CREATING │
│                 │ CONFIRM_FAIL  │ ERROR          │
├─────────────────┼───────────────┼────────────────┤
│ ORDER_CREATING  │ ORDER_CREATED │ TOSS_POPUP     │
│                 │ CONFIRM_FAIL  │ ERROR          │
├─────────────────┼───────────────┼────────────────┤
│ TOSS_POPUP      │ TOSS_SUCCESS  │ CONFIRMING     │
│                 │ TOSS_FAIL     │ ERROR          │
│                 │ USER_CANCEL   │ CANCELLED      │
│                 │ CONFIRM_FAIL  │ ❌ 미처리 (무시) │ ← 버그!
├─────────────────┼───────────────┼────────────────┤
│ ERROR           │ RESET         │ IDLE           │
│                 │ RETRY         │ RETRYING       │
├─────────────────┼───────────────┼────────────────┤
│ CANCELLED       │ RESET         │ IDLE           │
└─────────────────┴───────────────┴────────────────┘
```

**문제 1:** `TOSS_POPUP` 상태에서 `CONFIRM_FAIL` 이벤트를 처리하지 않음.
리듀서의 `TOSS_POPUP` case에 `CONFIRM_FAIL` 핸들러가 없어서 `return state`로 빠진다.

### 4-2. usePayment.ts의 catch 블록

```typescript
// usePayment.ts — 수정 전
catch (error) {
    releaseLock();
    dispatch({
        type: "CONFIRM_FAIL",    // ← 이 이벤트가 TOSS_POPUP에서 무시됨
        error: error instanceof Error ? error.message : "결제 중 오류 발생",
    });
    // 여기서 끝 — ERROR 상태가 되더라도 IDLE로 돌아가는 코드 없음
}
```

**문제 2:** catch 블록이 `CONFIRM_FAIL`만 보내고 끝남.
설령 `CONFIRM_FAIL`이 처리되어 `ERROR`로 전이되더라도,
`ERROR → IDLE`로 돌아가는 `RESET`을 아무도 보내지 않는다.

### 4-3. 문제 요약도

```
         usePayment.ts (catch 블록)
         ┌─────────────────────────┐
         │ dispatch(CONFIRM_FAIL)  │
         └───────────┬─────────────┘
                     │
                     ▼
         paymentReducer (상태 머신)
         ┌─────────────────────────┐
         │ state = TOSS_POPUP      │
         │                         │
         │ TOSS_SUCCESS? → No      │
         │ TOSS_FAIL?    → No      │
         │ USER_CANCEL?  → No      │
         │ CONFIRM_FAIL? → ❌ 없음  │
         │                         │
         │ return state (변화 없음) │
         └───────────┬─────────────┘
                     │
                     ▼
         Cart.tsx
         ┌─────────────────────────┐
         │ paymentState = TOSS_POPUP│
         │ TOSS_POPUP !== "IDLE"   │
         │ → isProcessing = true   │
         │ → 버튼 disabled         │
         │ → "결제 진행 중..."      │
         └─────────────────────────┘
```

---

## 5. 해결 방법

### 5-1. 수정 1 — RESET을 글로벌 이벤트로 승격

**수정 전:** `RESET`은 `ERROR`, `DONE`, `CANCELLED`, `NEEDS_RECOVERY`에서만 처리

**수정 후:** `RESET`은 switch문 진입 전에 체크 → 어떤 상태에서든 IDLE 복귀

```typescript
// types/payment.ts
export function paymentReducer(
    state: PaymentState,
    event: PaymentEvent
): PaymentState {
    // ✅ RESET은 어떤 상태에서든 IDLE로 복귀
    if (event.type === "RESET") return "IDLE";

    switch (state) {
        case "TOSS_POPUP":
            if (event.type === "TOSS_SUCCESS") return "CONFIRMING";
            if (event.type === "TOSS_FAIL") return "ERROR";
            if (event.type === "USER_CANCEL") return "CANCELLED";
            if (event.type === "CONFIRM_FAIL") return "ERROR";  // ✅ 추가
            return state;
        // ... 나머지 동일
    }
}
```

### 5-2. 수정 2 — catch에서 RESET 자동 디스패치

```typescript
// hooks/usePayment.ts
catch (error) {
    releaseLock();
    dispatch({
        type: "CONFIRM_FAIL",
        error: error instanceof Error ? error.message : "결제 중 오류 발생",
    });
    // ✅ ERROR 상태에서 바로 IDLE로 복귀 → 재결제 가능
    dispatch({ type: "RESET" });
}
```

### 5-3. 두 dispatch의 동작 순서

React의 `useReducer`는 같은 동기 블록 안에서 여러 `dispatch`를 호출하면
배치(batch)로 처리하지만 **순서는 보장**된다:

```
dispatch(CONFIRM_FAIL)   →   TOSS_POPUP → ERROR
dispatch(RESET)          →   ERROR → IDLE

최종 상태: IDLE ✅
```

---

## 6. 수정 후 전이 테이블

```
┌─────────────────┬───────────────┬────────────────┐
│ 현재 상태        │ 수신 이벤트    │ 다음 상태       │
├─────────────────┼───────────────┼────────────────┤
│ ✅ (모든 상태)   │ RESET         │ IDLE           │ ← 글로벌!
├─────────────────┼───────────────┼────────────────┤
│ IDLE            │ START_PAYMENT │ WAL_WRITING    │
├─────────────────┼───────────────┼────────────────┤
│ WAL_WRITING     │ WAL_WRITTEN   │ ORDER_CREATING │
│                 │ CONFIRM_FAIL  │ ERROR          │
├─────────────────┼───────────────┼────────────────┤
│ ORDER_CREATING  │ ORDER_CREATED │ TOSS_POPUP     │
│                 │ CONFIRM_FAIL  │ ERROR          │
├─────────────────┼───────────────┼────────────────┤
│ TOSS_POPUP      │ TOSS_SUCCESS  │ CONFIRMING     │
│                 │ TOSS_FAIL     │ ERROR          │
│                 │ USER_CANCEL   │ CANCELLED      │
│                 │ CONFIRM_FAIL  │ ERROR          │ ← 추가!
├─────────────────┼───────────────┼────────────────┤
│ ERROR           │ RETRY         │ RETRYING       │
│                 │ RECOVERY_NEEDED│ NEEDS_RECOVERY │
└─────────────────┴───────────────┴────────────────┘
```

---

## 7. 수정 후 팝업 취소 흐름

```
┌──────────────────────────────────────────────────────────────────┐
│                  ✅ 팝업 취소 시 수정 후 흐름                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  사용자 행동          dispatch()           paymentState           │
│  ─────────────       ──────────────       ──────────────         │
│                                                                  │
│  "결제하기" 클릭  →  START_PAYMENT    →   IDLE                   │
│                                           ↓                      │
│  WAL 기록 완료    →  WAL_WRITTEN      →   WAL_WRITING            │
│                                           ↓                      │
│  주문 생성 완료   →  ORDER_CREATED    →   ORDER_CREATING         │
│                                           ↓                      │
│  Toss SDK 호출    →  (모달 표시)      →   TOSS_POPUP             │
│                                           ↓                      │
│  사용자가 모달 닫기  →  Promise reject  →  catch 블록 실행       │
│                                           ↓                      │
│  catch 블록 ①    →  CONFIRM_FAIL     →   TOSS_POPUP → ERROR ✅  │
│                                           ↓                      │
│  catch 블록 ②    →  RESET            →   ERROR → IDLE ✅        │
│                                           ↓                      │
│  Cart.tsx: paymentState === "IDLE"  →  버튼 활성화 ✅            │
│                                                                  │
│  ═══════════════════════════════════════════════════════          │
│  ✅ "결제하기" 버튼 다시 표시                                     │
│  ✅ 재결제 가능                                                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8. 핵심 교훈

### 상태 머신 설계 시 체크리스트

```
┌─────────────────────────────────────────────────────────────────┐
│  ① 모든 상태에서 발생 가능한 이벤트를 빠짐없이 정의했는가?       │
│     → 특히 에러/취소 경로는 정상 경로보다 놓치기 쉽다            │
│                                                                  │
│  ② "탈출구 없는 상태(dead-end state)"가 존재하는가?              │
│     → 어떤 상태에서든 IDLE로 돌아갈 수 있는 경로가 있어야 한다   │
│                                                                  │
│  ③ 외부 라이브러리(Toss SDK)가 어떤 방식으로 실패하는지          │
│     (throw, reject, redirect) 모든 경우를 catch하고 있는가?      │
│                                                                  │
│  ④ UI의 활성/비활성 조건과 상태 머신의 전이가 일치하는가?        │
│     → Cart의 isProcessing은 "IDLE이 아니면 비활성"               │
│     → 상태 머신이 IDLE로 돌아가지 못하면 UI가 영원히 잠긴다      │
└─────────────────────────────────────────────────────────────────┘
```

### 글로벌 RESET 패턴

```
                    ┌─────────┐
      ┌─────────────│  IDLE   │◄──────────────────────────┐
      │             └────┬────┘                            │
      │                  │ START_PAYMENT                   │
      │                  ▼                                 │
      │          ┌──────────────┐                          │
      │          │ WAL_WRITING  │──CONFIRM_FAIL──→ ERROR ──┤
      │          └──────┬───────┘                          │
      │                 │ WAL_WRITTEN                      │
      │                 ▼                                  │
      │       ┌────────────────┐                           │
      │       │ ORDER_CREATING │──CONFIRM_FAIL──→ ERROR ──┤
      │       └────────┬───────┘                           │
      │                │ ORDER_CREATED                     │
      │                ▼                                   │
      │         ┌────────────┐                             │
      │         │ TOSS_POPUP │──CONFIRM_FAIL──→ ERROR ────┤
      │         │            │──USER_CANCEL──→ CANCELLED ──┤
      │         └─────┬──────┘                             │
      │               │ TOSS_SUCCESS                       │
      │               ▼                                    │
      │        ┌────────────┐                              │
      │        │ CONFIRMING │──CONFIRM_FAIL──→ ERROR ─────┤
      │        └─────┬──────┘                              │
      │              │ CONFIRM_SUCCESS                     │
      │              ▼                                     │
      │          ┌────────┐              RESET             │
      │          │  DONE  │ ─────────────────────────────→─┤
      │          └────────┘                                │
      │                                                    │
      └────────── RESET (어떤 상태에서든) ─────────────────┘
```

**RESET을 글로벌로 만든 이유:**
- 결제 플로우는 외부 의존성(Toss SDK, 네트워크)이 많아서 예측하지 못한 상태에서 실패할 수 있다
- 어떤 상태에서 멈추더라도 "비상 탈출구"가 항상 열려있어야 UI가 잠기지 않는다
- 이는 상태 머신에서 흔한 **안전망(safety net) 패턴**이다
