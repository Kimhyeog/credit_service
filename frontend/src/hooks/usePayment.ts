"use client";

import { useReducer, useCallback, useRef } from "react";
import { paymentReducer } from "@/types/payment";
import type { PaymentState } from "@/types/payment";
import { WALManager } from "@/services/recovery/WALManager";
import { createPaymentService } from "@/services/payment";
import { acquireLock, releaseLock } from "@/hooks/usePaymentLock";

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

  const startPayment = useCallback(async (params: PaymentFlowParams) => {
    // 1. 오프라인 체크
    if (typeof navigator !== "undefined" && !navigator.onLine) {
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
      // 3. WAL에 인텐트 기록
      dispatch({ type: "START_PAYMENT" });

      const walId = wal.write({
        orderId: null,
        paymentKey: null,
        amount: params.amount,
        items: params.items.map((i) => ({
          menuId: i.menuId,
          quantity: i.quantity,
        })),
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
    } catch (error) {
      releaseLock();
      dispatch({
        type: "CONFIRM_FAIL",
        error: error instanceof Error ? error.message : "결제 중 오류 발생",
      });
      // ERROR 상태에서 바로 IDLE로 복귀 → 재결제 가능
      dispatch({ type: "RESET" });
    }
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    walIdRef.current = null;
  }, []);

  return {
    state,
    startPayment,
    reset,
  };
}
