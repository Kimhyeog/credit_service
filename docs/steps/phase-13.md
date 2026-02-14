# Phase 13 — 테스트

## 목표

- 백엔드: 핵심 비즈니스 로직(주문/결제/웹훅/멱등성) 통합 테스트
- 프론트엔드: 순수 함수(paymentReducer, cartReducer, WALManager) 유닛 테스트
- 외부 의존성(Toss API, localStorage)은 mock으로 격리

---

## 현재 상태

| 항목 | 상태 |
|------|------|
| `backend/tests/` | `__init__.py`만 존재, 테스트 파일 없음 |
| `pytest`, `pytest-asyncio` | requirements.txt에 포함, 설치됨 |
| `pytest.ini` / `pyproject.toml` | 없음 (asyncio_mode 설정 필요) |
| `frontend/src/__tests__/` | 빈 디렉토리 3개 (components, hooks, services) |
| `vitest` | package.json에 없음, 미설치 |
| `vitest.config.ts` | 없음 |

---

## 생성 파일 (10개)

### 백엔드 (5개)

| # | 파일 | 테스트 수 |
|---|------|-----------|
| 1 | `backend/pyproject.toml` | (설정) |
| 2 | `backend/tests/conftest.py` | fixtures |
| 3 | `backend/tests/test_orders.py` | 6개 |
| 4 | `backend/tests/test_payments.py` | 5개 |
| 5 | `backend/tests/test_webhooks.py` | 4개 |

### 프론트엔드 (5개)

| # | 파일 | 테스트 수 |
|---|------|-----------|
| 6 | `frontend/vitest.config.ts` | (설정) |
| 7 | `frontend/src/__tests__/hooks/paymentReducer.test.ts` | 10개+ |
| 8 | `frontend/src/__tests__/services/WALManager.test.ts` | 7개 |
| 9 | `frontend/src/__tests__/hooks/cartReducer.test.ts` | 6개 |
| 10 | `frontend/src/__tests__/services/idempotency.test.ts` | 3개 |

---

## 구현 순서

### Step 1. 백엔드 pytest 설정

**파일:** `backend/pyproject.toml`

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

`asyncio_mode = "auto"` — 모든 async 테스트 함수에 자동으로 `@pytest.mark.asyncio` 적용.

---

### Step 2. conftest.py — 테스트 fixture

**파일:** `backend/tests/conftest.py`

```python
import pytest
import os
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

# 테스트 DB 경로 설정 — 앱 import보다 먼저!
os.environ["DATABASE_URL"] = "file:./test.db"

from app.main import app
from app.db.client import db


@pytest.fixture(scope="session", autouse=True)
async def setup_db():
    """테스트 세션: DB 연결 + 스키마 push + 시드 → 테스트 실행 → 정리"""
    await db.connect()

    # 시드 메뉴 생성 (테스트 전체에서 공유)
    await db.menu.create(
        data={"name": "아메리카노", "price": 4500, "category": "커피"}
    )
    await db.menu.create(
        data={"name": "카페라떼", "price": 5500, "category": "커피"}
    )
    await db.menu.create(
        data={"name": "크루아상", "price": 4000, "category": "베이커리"}
    )

    yield

    await db.disconnect()


@pytest.fixture(autouse=True)
async def cleanup():
    """각 테스트 후 주문/결제/웹훅 데이터 정리 (메뉴는 유지)"""
    yield
    await db.webhookevent.delete_many()
    await db.idempotencyrecord.delete_many()
    await db.payment.delete_many()
    await db.orderitem.delete_many()
    await db.order.delete_many()


@pytest.fixture
async def client():
    """FastAPI async test client"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def menus():
    """현재 DB의 메뉴 목록 반환"""
    return await db.menu.find_many()


@pytest.fixture
def mock_toss():
    """Toss API mock — confirm/get/cancel 모두 AsyncMock"""
    with patch("app.services.payment_service.toss_client") as mock:
        mock.confirm_payment = AsyncMock(return_value={
            "paymentKey": "test_pk_123",
            "orderId": "test-order-id",
            "status": "DONE",
            "method": "카드",
            "approvedAt": "2026-02-15T12:00:00+09:00",
        })
        mock.get_payment = AsyncMock(return_value={
            "paymentKey": "test_pk_123",
            "status": "DONE",
        })
        mock.cancel_payment = AsyncMock(return_value={
            "paymentKey": "test_pk_123",
            "status": "CANCELED",
        })
        yield mock
```

**핵심 설계 결정:**
- `scope="session"` — DB 연결과 시드는 세션당 1번 (속도)
- `autouse=True` cleanup — 각 테스트 후 데이터 정리 (격리)
- 메뉴는 정리하지 않음 — 모든 테스트에서 공유 (불변 데이터)
- `mock_toss` — `payment_service`가 사용하는 `toss_client`만 패치 (웹훅 서비스는 별도 패치)

**주의:** `os.environ["DATABASE_URL"]`은 `from app.main import app`보다 **위에** 있어야 함. Settings가 모듈 로드 시 환경변수를 읽기 때문.

---

### Step 3. test_orders.py — 주문 테스트 (6개)

**파일:** `backend/tests/test_orders.py`

```python
import pytest
from httpx import AsyncClient


def make_idempotency_key(suffix=""):
    """테스트용 멱등성 키 생성 (16자 이상)"""
    return f"test_idem_key_{suffix or '0001'}"


async def create_order(client: AsyncClient, menus, suffix="0001"):
    """헬퍼: 주문 생성 + 응답 반환"""
    key = make_idempotency_key(suffix)
    response = await client.post(
        "/api/orders",
        json={
            "items": [
                {"menu_id": menus[0].id, "quantity": 2},
                {"menu_id": menus[1].id, "quantity": 1},
            ],
            "idempotency_key": key,
            "source": "POS",
            "order_mode": "DINE_IN",
        },
        headers={"Idempotency-Key": key},
    )
    return response


async def test_create_order_success(client, menus):
    """주문 생성 — 메뉴 2종, 금액 = 4500*2 + 5500*1 = 14500"""
    res = await create_order(client, menus)
    assert res.status_code == 201
    data = res.json()
    assert data["totalAmount"] == 14500
    assert data["status"] == "PENDING"
    assert data["orderNumber"] >= 1
    assert len(data["items"]) == 2


async def test_create_order_invalid_menu(client):
    """존재하지 않는 메뉴 ID → 404"""
    key = make_idempotency_key("bad_menu")
    res = await client.post(
        "/api/orders",
        json={
            "items": [{"menu_id": "nonexistent-id", "quantity": 1}],
            "idempotency_key": key,
        },
        headers={"Idempotency-Key": key},
    )
    assert res.status_code == 404


async def test_list_orders(client, menus):
    """주문 목록 조회 — 생성 후 조회"""
    await create_order(client, menus, "list1")
    res = await client.get("/api/orders")
    assert res.status_code == 200
    assert len(res.json()) >= 1


async def test_list_orders_filter(client, menus):
    """주문 목록 상태 필터 — PAID 필터 시 PENDING 주문 미포함"""
    await create_order(client, menus, "filter1")
    res = await client.get("/api/orders?status=PAID")
    assert res.status_code == 200
    assert len(res.json()) == 0  # PENDING 주문만 있으므로


async def test_cancel_order_success(client, menus):
    """주문 취소 — PENDING 상태에서 취소 가능"""
    create_res = await create_order(client, menus, "cancel1")
    order_id = create_res.json()["id"]
    key = make_idempotency_key("cancel1_op")
    res = await client.patch(
        f"/api/orders/{order_id}/cancel",
        headers={"Idempotency-Key": key},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "CANCELLED"


async def test_cancel_order_invalid_status(client, menus, mock_toss):
    """PAID 상태 주문 취소 시도 → 400"""
    # 주문 생성
    create_res = await create_order(client, menus, "cancel_bad")
    order_id = create_res.json()["id"]

    # 결제 confirm으로 PAID로 전환
    await client.post(
        "/api/payments/confirm",
        json={
            "payment_key": "pk_cancel_test",
            "order_id": order_id,
            "amount": 14500,
        },
    )

    # PAID 상태에서 cancel_order 시도
    key = make_idempotency_key("cancel_bad_op")
    res = await client.patch(
        f"/api/orders/{order_id}/cancel",
        headers={"Idempotency-Key": key},
    )
    assert res.status_code == 400
```

---

### Step 4. test_payments.py — 결제 테스트 (5개)

**파일:** `backend/tests/test_payments.py`

```python
import pytest
from httpx import AsyncClient
from tests.test_orders import create_order, make_idempotency_key


async def test_confirm_success(client, menus, mock_toss):
    """결제 승인 — Toss mock, Payment DONE, Order PAID"""
    create_res = await create_order(client, menus, "pay_ok")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    res = await client.post(
        "/api/payments/confirm",
        json={
            "payment_key": "pk_success",
            "order_id": order_id,
            "amount": amount,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "DONE"

    # Order가 PAID로 변경되었는지 확인
    order_res = await client.get(f"/api/orders/{order_id}")
    assert order_res.json()["status"] == "PAID"


async def test_confirm_amount_mismatch(client, menus, mock_toss):
    """결제 승인 — 금액 불일치 → 400"""
    create_res = await create_order(client, menus, "pay_mismatch")
    order_id = create_res.json()["id"]

    res = await client.post(
        "/api/payments/confirm",
        json={
            "payment_key": "pk_mismatch",
            "order_id": order_id,
            "amount": 99999,  # 실제: 14500
        },
    )
    assert res.status_code == 400
    assert "mismatch" in res.json()["detail"].lower()


async def test_confirm_already_paid(client, menus, mock_toss):
    """이미 PAID인 주문 → 400"""
    create_res = await create_order(client, menus, "pay_dup")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    # 1차 confirm
    await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_dup_1", "order_id": order_id, "amount": amount},
    )

    # 2차 confirm → 이미 PAID
    res = await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_dup_2", "order_id": order_id, "amount": amount},
    )
    assert res.status_code == 400


async def test_get_payment(client, menus, mock_toss):
    """결제 상태 조회"""
    create_res = await create_order(client, menus, "pay_get")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_get", "order_id": order_id, "amount": amount},
    )

    res = await client.get(f"/api/payments/{order_id}")
    assert res.status_code == 200
    assert res.json()["status"] == "DONE"


async def test_cancel_payment(client, menus, mock_toss):
    """결제 취소 — DONE → CANCELED"""
    create_res = await create_order(client, menus, "pay_cancel")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    # Confirm 먼저
    await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_cancel", "order_id": order_id, "amount": amount},
    )

    # Cancel
    res = await client.post(
        f"/api/payments/{order_id}/cancel",
        json={"reason": "테스트 취소"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "CANCELED"
```

---

### Step 5. test_webhooks.py — 웹훅 테스트 (4개)

**파일:** `backend/tests/test_webhooks.py`

```python
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient
from app.config import settings
from app.db.client import db
from tests.test_orders import create_order, make_idempotency_key


async def make_paid_order(client, menus, mock_toss, suffix):
    """헬퍼: PAID 상태 주문 + Payment 생성"""
    create_res = await create_order(client, menus, suffix)
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]
    pk = f"pk_wh_{suffix}"

    await client.post(
        "/api/payments/confirm",
        json={"payment_key": pk, "order_id": order_id, "amount": amount},
    )
    return order_id, pk


async def test_valid_webhook(client, menus, mock_toss):
    """유효한 웹훅 → Payment/Order 상태 업데이트"""
    order_id, pk = await make_paid_order(client, menus, mock_toss, "wh_valid")

    # Toss API 재확인 mock (webhook_service용)
    with patch("app.services.webhook_service.toss_client") as wh_mock:
        wh_mock.get_payment = AsyncMock(return_value={
            "paymentKey": pk,
            "status": "CANCELED",
        })

        res = await client.post(
            "/api/webhooks/toss",
            json={
                "secret": settings.TOSS_WEBHOOK_SECRET,
                "eventType": "PAYMENT_STATUS_CHANGED",
                "data": {"paymentKey": pk, "status": "CANCELED"},
            },
        )

    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    # DB 확인: Payment CANCELED, Order CANCELLED
    payment = await db.payment.find_unique(where={"paymentKey": pk})
    assert payment.status == "CANCELED"


async def test_invalid_secret(client):
    """잘못된 시크릿 → 무시 (status: ok, DB 변경 없음)"""
    res = await client.post(
        "/api/webhooks/toss",
        json={
            "secret": "wrong_secret",
            "eventType": "PAYMENT_STATUS_CHANGED",
            "data": {"paymentKey": "pk_any", "status": "DONE"},
        },
    )
    assert res.status_code == 200

    # WebhookEvent 레코드 생성되지 않음
    events = await db.webhookevent.find_many()
    assert len(events) == 0


async def test_duplicate_webhook(client, menus, mock_toss):
    """중복 웹훅 → 두 번째 무시"""
    order_id, pk = await make_paid_order(client, menus, mock_toss, "wh_dup")

    webhook_body = {
        "secret": settings.TOSS_WEBHOOK_SECRET,
        "eventType": "PAYMENT_STATUS_CHANGED",
        "data": {"paymentKey": pk, "status": "CANCELED"},
    }

    with patch("app.services.webhook_service.toss_client") as wh_mock:
        wh_mock.get_payment = AsyncMock(return_value={
            "paymentKey": pk, "status": "CANCELED",
        })
        await client.post("/api/webhooks/toss", json=webhook_body)
        await client.post("/api/webhooks/toss", json=webhook_body)

    # WebhookEvent는 1개만 (두 번째는 중복으로 스킵)
    events = await db.webhookevent.find_many(
        where={"paymentKey": pk, "eventType": "PAYMENT_STATUS_CHANGED"}
    )
    # 첫 번째만 기록됨 (processed=true), 두 번째는 기록 자체 안 됨
    assert len(events) == 1


async def test_missing_payment_key(client):
    """paymentKey 누락 → 무시"""
    res = await client.post(
        "/api/webhooks/toss",
        json={
            "secret": settings.TOSS_WEBHOOK_SECRET,
            "eventType": "PAYMENT_STATUS_CHANGED",
            "data": {},
        },
    )
    assert res.status_code == 200
    events = await db.webhookevent.find_many()
    assert len(events) == 0
```

---

### Step 6. 프론트엔드 Vitest 설정

**설치:**
```bash
cd frontend && npm install -D vitest
```

**파일:** `frontend/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

**포인트:**
- `environment: "node"` — 순수 로직 테스트에 DOM 불필요 (빠름)
- `@` alias — 프로덕션 코드의 `@/` import와 동일하게 해석
- `globals: true` — `describe`, `it`, `expect`를 import 없이 사용

---

### Step 7. paymentReducer 테스트

**파일:** `frontend/src/__tests__/hooks/paymentReducer.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { paymentReducer } from "@/types/payment";
import type { PaymentState, PaymentEvent } from "@/types/payment";

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
    expect(paymentReducer("ERROR", { type: "RECOVERY_NEEDED" })).toBe("NEEDS_RECOVERY");
  });

  // 리셋
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
```

---

### Step 8. WALManager 테스트

**파일:** `frontend/src/__tests__/services/WALManager.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { WALManager } from "@/services/recovery/WALManager";

// localStorage mock
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// crypto.randomUUID mock
Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => `mock-uuid-${Math.random().toString(36).slice(2, 10)}`,
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
    wal = new WALManager();
  });

  it("write → readAll 로 확인", () => {
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
    wal.write({ ...BASE_ENTRY, state: "ORDER_CREATING" });
    expect(wal.getPending()).toHaveLength(1);
  });

  it("cleanup → 만료 엔트리 제거", () => {
    // 직접 localStorage에 오래된 엔트리 삽입
    const old = {
      ...BASE_ENTRY,
      id: "old-entry",
      createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25시간 전
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
    };
    const fresh = {
      ...BASE_ENTRY,
      id: "fresh-entry",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    localStorageMock.setItem(
      "toss_sync_pos_wal",
      JSON.stringify([old, fresh])
    );

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
```

---

### Step 9. cartReducer 테스트

**파일:** `frontend/src/__tests__/hooks/cartReducer.test.ts`

`cartReducer`는 `CartProvider.tsx`에서 export되지 않으므로, 테스트에서 직접 import할 수 없다.

**두 가지 방법:**
1. `cartReducer`와 `calcTotal`을 별도 파일로 추출 후 export (권장)
2. CartProvider에서 `cartReducer`를 named export 추가

**방법 2 (최소 변경):** `CartProvider.tsx`에서 `cartReducer`를 export.

```typescript
// CartProvider.tsx 변경: function → export function
export function cartReducer(state: CartState, action: CartAction): CartState {
```

테스트 파일:

```typescript
import { describe, it, expect } from "vitest";
import { cartReducer } from "@/providers/CartProvider";
import type { CartItem } from "@/providers/CartProvider";

const MENU_A = { id: "a", name: "아메리카노", price: 4500, category: "커피", isAvailable: true };
const MENU_B = { id: "b", name: "라떼", price: 5500, category: "커피", isAvailable: true };

const EMPTY = { items: [], totalAmount: 0, orderMode: "DINE_IN" as const };

describe("cartReducer", () => {
  it("ADD_ITEM — 새 아이템 추가", () => {
    const state = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(1);
    expect(state.totalAmount).toBe(4500);
  });

  it("ADD_ITEM — 기존 아이템 수량 +1", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, { type: "ADD_ITEM", menu: MENU_A });
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0].quantity).toBe(2);
    expect(s2.totalAmount).toBe(9000);
  });

  it("REMOVE_ITEM", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, { type: "REMOVE_ITEM", menuId: "a" });
    expect(s2.items).toHaveLength(0);
    expect(s2.totalAmount).toBe(0);
  });

  it("UPDATE_QUANTITY — 수량 변경", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, { type: "UPDATE_QUANTITY", menuId: "a", quantity: 5 });
    expect(s2.items[0].quantity).toBe(5);
    expect(s2.totalAmount).toBe(22500);
  });

  it("UPDATE_QUANTITY — 0 이하 시 삭제", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, { type: "UPDATE_QUANTITY", menuId: "a", quantity: 0 });
    expect(s2.items).toHaveLength(0);
  });

  it("CLEAR", () => {
    let s = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    s = cartReducer(s, { type: "ADD_ITEM", menu: MENU_B });
    s = cartReducer(s, { type: "CLEAR" });
    expect(s.items).toHaveLength(0);
    expect(s.totalAmount).toBe(0);
  });
});
```

---

### Step 10. idempotency 유틸 테스트

**파일:** `frontend/src/__tests__/services/idempotency.test.ts`

```typescript
import { describe, it, expect } from "vitest";
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
    // prefix (pos_해시) 동일, timestamp/random은 다름
    expect(a.split("_")[1]).toBe(b.split("_")[1]);
  });

  it("다른 입력 → 다른 해시", () => {
    const a = generateIdempotencyKey([{ menuId: "m1", quantity: 1 }]);
    const b = generateIdempotencyKey([{ menuId: "m2", quantity: 1 }]);
    expect(a.split("_")[1]).not.toBe(b.split("_")[1]);
  });
});
```

---

## 실행 방법

```bash
# 백엔드 — 테스트 DB 별도 사용
cd backend
source venv/bin/activate
prisma db push          # test.db 스키마 적용 (DATABASE_URL은 conftest에서 설정)
pytest -v               # 전체 실행
pytest tests/test_orders.py -v          # 주문만
pytest tests/test_payments.py -k "confirm_success" -v  # 특정 케이스

# 프론트엔드
cd frontend
npm install -D vitest   # 최초 1회
npx vitest run          # 전체 실행
npx vitest run src/__tests__/hooks/paymentReducer.test.ts  # 특정 파일
```

---

## 파일 체크리스트

- [ ] `backend/pyproject.toml` — pytest asyncio_mode 설정
- [ ] `backend/tests/conftest.py` — fixtures (DB, client, menus, mock_toss)
- [ ] `backend/tests/test_orders.py` — 6개 테스트
- [ ] `backend/tests/test_payments.py` — 5개 테스트
- [ ] `backend/tests/test_webhooks.py` — 4개 테스트
- [ ] `frontend/vitest.config.ts` — Vitest 설정
- [ ] `frontend/src/__tests__/hooks/paymentReducer.test.ts` — 12개+ 테스트
- [ ] `frontend/src/__tests__/services/WALManager.test.ts` — 7개 테스트
- [ ] `frontend/src/__tests__/hooks/cartReducer.test.ts` — 6개 테스트
- [ ] `frontend/src/__tests__/services/idempotency.test.ts` — 3개 테스트
- [ ] `frontend/src/providers/CartProvider.tsx` — cartReducer export 추가 (수정)
