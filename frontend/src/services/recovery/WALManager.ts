import type { PaymentState } from "@/types/payment";

/** WAL 엔트리 — 하나의 결제 시도에 대한 기록 */
export interface WALEntry {
  id: string;
  orderId: string | null;
  paymentKey: string | null;
  amount: number;
  items: { menuId: string; quantity: number }[];
  idempotencyKey: string;
  state: PaymentState;
  createdAt: number;
  updatedAt: number;
}

const WAL_STORAGE_KEY = "toss_sync_pos_wal";

export class WALManager {
  /** WAL에 새 인텐트 기록, 생성된 ID 반환 */
  write(entry: Omit<WALEntry, "id" | "createdAt" | "updatedAt">): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    const entries = this.readAll();
    entries.push({ ...entry, id, createdAt: now, updatedAt: now });
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
    return id;
  }

  /** 특정 WAL 엔트리 부분 업데이트 */
  update(id: string, patch: Partial<WALEntry>): void {
    const entries = this.readAll().map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e
    );
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }

  /** 완료된 WAL 엔트리 삭제 */
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

  /** 미완료(복구 필요) 엔트리만 조회 */
  getPending(): WALEntry[] {
    const terminal: PaymentState[] = ["DONE", "CANCELLED", "IDLE"];
    return this.readAll().filter((e) => !terminal.includes(e.state));
  }

  /** 만료된 엔트리 정리 (기본 24시간) */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    const entries = this.readAll().filter((e) => e.createdAt > cutoff);
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }
}
