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
 * 결제 상태 머신 리듀서 (순수 함수)
 *
 * 현재 상태 + 이벤트 → 다음 상태
 * 부작용(API 호출, WAL 기록)은 usePayment 훅에서 처리
 */
export function paymentReducer(
  state: PaymentState,
  event: PaymentEvent
): PaymentState {
  // RESET은 어떤 상태에서든 IDLE로 복귀
  if (event.type === "RESET") return "IDLE";

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
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "CONFIRMING":
      if (event.type === "CONFIRM_SUCCESS") return "DONE";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "ERROR":
      if (event.type === "RETRY") return "RETRYING";
      if (event.type === "RECOVERY_NEEDED") return "NEEDS_RECOVERY";
      return state;

    case "RETRYING":
      if (event.type === "CONFIRM_SUCCESS") return "DONE";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "DONE":
    case "CANCELLED":
    case "NEEDS_RECOVERY":
      return state;

    default:
      return state;
  }
}
