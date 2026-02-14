import { describe, it, expect } from "vitest";

// crypto.randomUUID mock (idempotency.ts에서 사용)
if (!globalThis.crypto?.randomUUID) {
  let counter = 0;
  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () => `mock-uuid-${++counter}-abcdefgh`,
    },
    configurable: true,
  });
}

import { generateIdempotencyKey } from "@/utils/idempotency";

describe("generateIdempotencyKey", () => {
  it("16자 이상 키 생성", () => {
    const key = generateIdempotencyKey([{ menuId: "m1", quantity: 1 }]);
    expect(key.length).toBeGreaterThanOrEqual(16);
  });

  it("동일 입력 → 동일 해시 prefix", () => {
    const items = [{ menuId: "m1", quantity: 2 }];
    const a = generateIdempotencyKey(items);
    const b = generateIdempotencyKey(items);
    // pos_{hash}_{timestamp}_{random} — hash 부분이 같아야 함
    const hashA = a.split("_")[1];
    const hashB = b.split("_")[1];
    expect(hashA).toBe(hashB);
  });

  it("다른 입력 → 다른 해시", () => {
    const a = generateIdempotencyKey([{ menuId: "m1", quantity: 1 }]);
    const b = generateIdempotencyKey([{ menuId: "m2", quantity: 1 }]);
    expect(a.split("_")[1]).not.toBe(b.split("_")[1]);
  });
});
