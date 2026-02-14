import { WALManager } from "./WALManager";
import type { WALEntry } from "./WALManager";
import { api } from "../api";
import type { ApiError } from "../api";

/** 복구 결과 — UI에서 배너 표시에 사용 */
export interface RecoveryResult {
  walId: string;
  orderId: string | null;
  action: "confirmed" | "cancelled" | "needs_manual" | "cleaned";
  message: string;
}

export class RecoveryService {
  private wal = new WALManager();

  /** 모든 미완료 WAL 엔트리를 순회하며 복구 시도 */
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
    // Case 1: 주문 미생성 → WAL 정리
    if (!entry.orderId) {
      this.wal.remove(entry.id);
      return {
        walId: entry.id,
        orderId: null,
        action: "cleaned",
        message: "주문 미생성 — WAL 정리됨",
      };
    }

    // Case 2: orderId 있음 → 서버 상태 확인
    try {
      const payment = await api.get<{
        status: string;
        paymentKey: string | null;
      }>(`/api/payments/${entry.orderId}`);

      // 이미 결제 완료
      if (payment.status === "DONE") {
        this.wal.remove(entry.id);
        return {
          walId: entry.id,
          orderId: entry.orderId,
          action: "confirmed",
          message: "서버에서 결제 완료 확인됨",
        };
      }

      // 결제 진행 중 + paymentKey 있음 → confirm 재시도
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
          // confirm 재시도 실패 → 아래에서 needs_manual 처리
        }
      }

      // 그 외 → 수동 복구 필요
      this.wal.update(entry.id, { state: "NEEDS_RECOVERY" });
      return {
        walId: entry.id,
        orderId: entry.orderId,
        action: "needs_manual",
        message: `수동 확인 필요 (서버 상태: ${payment.status})`,
      };
    } catch (err) {
      const apiErr = err as ApiError;

      // 404 = 주문은 생성됐지만 결제가 시작되지 않음 → WAL 정리
      if (apiErr.status === 404) {
        this.wal.remove(entry.id);
        return {
          walId: entry.id,
          orderId: entry.orderId,
          action: "cleaned",
          message: "결제 미시작 주문 — WAL 정리됨",
        };
      }

      // 그 외 (네트워크 에러 등) → 수동 확인 필요
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
