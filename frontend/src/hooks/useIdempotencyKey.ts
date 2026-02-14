import { useRef, useCallback } from "react";
import { generateIdempotencyKey } from "@/utils/idempotency";

/**
 * 결제 플로우 동안 단일 멱등성 키를 유지하는 훅
 *
 * - getKey(): 현재 키 반환 (없으면 새로 생성)
 * - reset(): 키 초기화 (새 주문 시작 시)
 *
 * useRef로 리렌더링 없이 키를 유지한다.
 * 장바구니 CLEAR 등으로 items가 바뀌어도 기존 키가 보존된다.
 */
export function useIdempotencyKey(
  items: { menuId: string; quantity: number }[]
) {
  const keyRef = useRef<string | null>(null);

  const getKey = useCallback(() => {
    if (!keyRef.current) {
      keyRef.current = generateIdempotencyKey(items);
    }
    return keyRef.current;
  }, [items]);

  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { getKey, reset };
}
