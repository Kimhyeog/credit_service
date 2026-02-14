import { describe, it, expect, beforeEach } from "vitest";
import { WALManager } from "@/services/recovery/WALManager";

// localStorage mock
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
  get length() {
    return Object.keys(store).length;
  },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// crypto.randomUUID mock
let uuidCounter = 0;
Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => `mock-uuid-${++uuidCounter}`,
  },
});

const BASE_ENTRY = {
  orderId: null,
  paymentKey: null,
  amount: 5000,
  items: [{ menuId: "m1", quantity: 2 }],
  idempotencyKey: "test_key_1234567890",
  state: "WAL_WRITING" as const,
};

describe("WALManager", () => {
  let wal: WALManager;

  beforeEach(() => {
    localStorageMock.clear();
    uuidCounter = 0;
    wal = new WALManager();
  });

  it("write → readAll로 확인", () => {
    const id = wal.write(BASE_ENTRY);
    const all = wal.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].amount).toBe(5000);
  });

  it("update → 부분 업데이트", () => {
    const id = wal.write(BASE_ENTRY);
    wal.update(id, { orderId: "order-123", state: "ORDER_CREATING" });
    const entry = wal.readAll()[0];
    expect(entry.orderId).toBe("order-123");
    expect(entry.state).toBe("ORDER_CREATING");
    expect(entry.updatedAt).toBeGreaterThanOrEqual(entry.createdAt);
  });

  it("remove → 삭제 확인", () => {
    const id = wal.write(BASE_ENTRY);
    wal.remove(id);
    expect(wal.readAll()).toHaveLength(0);
  });

  it("getPending → 터미널 상태 제외", () => {
    wal.write({ ...BASE_ENTRY, state: "DONE" });
    wal.write({ ...BASE_ENTRY, state: "CANCELLED" });
    wal.write({ ...BASE_ENTRY, state: "IDLE" });
    wal.write({ ...BASE_ENTRY, state: "ORDER_CREATING" });
    expect(wal.getPending()).toHaveLength(1);
  });

  it("cleanup → 만료 엔트리 제거", () => {
    const old = {
      ...BASE_ENTRY,
      id: "old-entry",
      createdAt: Date.now() - 25 * 60 * 60 * 1000,
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
    };
    const fresh = {
      ...BASE_ENTRY,
      id: "fresh-entry",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    localStorageMock.setItem("toss_sync_pos_wal", JSON.stringify([old, fresh]));

    wal.cleanup();
    expect(wal.readAll()).toHaveLength(1);
    expect(wal.readAll()[0].id).toBe("fresh-entry");
  });

  it("readAll — localStorage 비정상 데이터 → 빈 배열", () => {
    localStorageMock.setItem("toss_sync_pos_wal", "not-json!!!");
    expect(wal.readAll()).toEqual([]);
  });

  it("여러 엔트리 write → 순서 보존", () => {
    wal.write({ ...BASE_ENTRY, amount: 1000 });
    wal.write({ ...BASE_ENTRY, amount: 2000 });
    wal.write({ ...BASE_ENTRY, amount: 3000 });
    const amounts = wal.readAll().map((e) => e.amount);
    expect(amounts).toEqual([1000, 2000, 3000]);
  });
});
