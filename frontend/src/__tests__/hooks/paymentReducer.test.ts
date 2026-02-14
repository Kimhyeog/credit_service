import { describe, it, expect } from "vitest";
import { paymentReducer } from "@/types/payment";
import type { PaymentState } from "@/types/payment";

describe("paymentReducer", () => {
  // 정상 결제 플로우
  it("IDLE → START_PAYMENT → WAL_WRITING", () => {
    expect(paymentReducer("IDLE", { type: "START_PAYMENT" })).toBe("WAL_WRITING");
  });

  it("WAL_WRITING → WAL_WRITTEN → ORDER_CREATING", () => {
    expect(
      paymentReducer("WAL_WRITING", { type: "WAL_WRITTEN", walId: "w1" })
    ).toBe("ORDER_CREATING");
  });

  it("ORDER_CREATING → ORDER_CREATED → TOSS_POPUP", () => {
    expect(
      paymentReducer("ORDER_CREATING", { type: "ORDER_CREATED", orderId: "o1" })
    ).toBe("TOSS_POPUP");
  });

  it("TOSS_POPUP → TOSS_SUCCESS → CONFIRMING", () => {
    expect(
      paymentReducer("TOSS_POPUP", {
        type: "TOSS_SUCCESS",
        paymentKey: "pk1",
        orderId: "o1",
        amount: 5000,
      })
    ).toBe("CONFIRMING");
  });

  it("CONFIRMING → CONFIRM_SUCCESS → DONE", () => {
    expect(paymentReducer("CONFIRMING", { type: "CONFIRM_SUCCESS" })).toBe("DONE");
  });

  // 에러 + 재시도
  it("ORDER_CREATING → CONFIRM_FAIL → ERROR", () => {
    expect(
      paymentReducer("ORDER_CREATING", { type: "CONFIRM_FAIL", error: "e" })
    ).toBe("ERROR");
  });

  it("ERROR → RETRY → RETRYING", () => {
    expect(paymentReducer("ERROR", { type: "RETRY" })).toBe("RETRYING");
  });

  it("RETRYING → CONFIRM_SUCCESS → DONE", () => {
    expect(paymentReducer("RETRYING", { type: "CONFIRM_SUCCESS" })).toBe("DONE");
  });

  // 복구 불가
  it("ERROR → RECOVERY_NEEDED → NEEDS_RECOVERY", () => {
    expect(paymentReducer("ERROR", { type: "RECOVERY_NEEDED" })).toBe(
      "NEEDS_RECOVERY"
    );
  });

  // 리셋 — 여러 터미널 상태에서 IDLE로
  it.each<PaymentState>(["DONE", "CANCELLED", "NEEDS_RECOVERY", "ERROR"])(
    "%s → RESET → IDLE",
    (state) => {
      expect(paymentReducer(state, { type: "RESET" })).toBe("IDLE");
    }
  );

  // 잘못된 전이 → 상태 유지
  it("IDLE + CONFIRM_SUCCESS → IDLE (무시)", () => {
    expect(paymentReducer("IDLE", { type: "CONFIRM_SUCCESS" })).toBe("IDLE");
  });

  it("DONE + START_PAYMENT → DONE (무시)", () => {
    expect(paymentReducer("DONE", { type: "START_PAYMENT" })).toBe("DONE");
  });
});
