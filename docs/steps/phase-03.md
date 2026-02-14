# Phase 3. 백엔드 — 메뉴 & 주문 API

> **목표:** 메뉴 CRUD + 시드 데이터 + 주문 생성/조회/취소 API + 비즈니스 로직
>
> **예상 소요:** 60~90분
>
> **선행 조건:** Phase 2 완료 (DB, Pydantic 스키마, FastAPI 앱)

---

## 왜 이 단계가 필요한가?

POS 시스템의 핵심은 **"메뉴를 보고 → 주문을 생성하는 것"**이다. 결제 로직을 붙이기 전에 이 기본 흐름이 확실히 동작해야 한다. 또한 주문 서비스의 `totalAmount 계산`, `가격 스냅샷 저장` 같은 비즈니스 규칙이 여기서 확립된다.

---

## 구현 TODO

### Step 3-1. 메뉴 라우터

**파일:** `backend/app/routers/menus.py`

```python
router = APIRouter(prefix="/api/menus", tags=["menus"])
```

구현할 엔드포인트:

| 메서드                   | 경로                             | 동작                          |
| ------------------------ | -------------------------------- | ----------------------------- |
| `GET /api/menus`         | `isAvailable=true`인 메뉴만 조회 | 프론트에서 메뉴 그리드에 표시 |
| `POST /api/menus`        | 새 메뉴 등록                     | 관리자용                      |
| `PUT /api/menus/{id}`    | 메뉴 수정 (이름, 가격, 카테고리) | 관리자용                      |
| `DELETE /api/menus/{id}` | `isAvailable=false`로 변경       | soft delete                   |

**왜 soft delete?**

- 이미 주문된 `OrderItem`이 이 메뉴를 참조하고 있다
- 물리 삭제하면 외래키 제약 위반 또는 주문 이력 조회 불가
- `isAvailable=false`로 숨기되, 과거 주문에서는 여전히 참조 가능

#### 요청 스키마

메뉴 엔드포인트는 주문과 달리 전용 스키마를 라우터 파일 내에 정의한다. 메뉴 CRUD는 이 파일에서만 쓰이므로 `schemas.py`에 넣지 않아도 된다.

```python
class MenuCreate(BaseModel):
    name: str           # 메뉴 이름 (필수)
    price: int          # 원 단위 가격 (필수)
    category: str       # "커피", "음료", "베이커리" 등 (필수)
    imageUrl: str | None = None  # 이미지 URL (선택)

class MenuUpdate(BaseModel):
    name: str | None = None      # 수정할 필드만 보내면 됨
    price: int | None = None     # None인 필드는 무시됨
    category: str | None = None
    imageUrl: str | None = None
```

`MenuUpdate`의 필드가 전부 `None` 가능인 이유: 이름만 바꾸고 싶으면 `{"name": "새이름"}`만 보내면 되고, 나머지는 건드리지 않는다.

#### GET — 메뉴 목록 조회

```python
@router.get("")
async def list_menus():
    db = get_db()
    menus = await db.menu.find_many(
        where={"isAvailable": True},   # soft delete된 메뉴는 제외
        order={"category": "asc"},     # 카테고리 가나다순 정렬
    )
    return menus
```

- `isAvailable=True`인 것만 반환 → DELETE로 숨긴 메뉴는 목록에 안 나옴
- 프론트엔드 메뉴 그리드에서 이 API를 호출

#### POST — 메뉴 등록

```python
@router.post("", status_code=201)
async def create_menu(body: MenuCreate):
    db = get_db()
    menu = await db.menu.create(data=body.model_dump(exclude_none=True))
    return menu
```

- `body.model_dump(exclude_none=True)` — Pydantic 모델을 딕셔너리로 변환하되, `None`인 필드(예: `imageUrl`)는 제외
- `status_code=201` — HTTP 201 Created 반환 (리소스 생성 성공의 표준 응답 코드)

```
body.model_dump() 동작:

MenuCreate(name="아메리카노", price=4500, category="커피", imageUrl=None)
    │
    ├─ model_dump()              → {"name": "아메리카노", "price": 4500, "category": "커피", "imageUrl": None}
    └─ model_dump(exclude_none=True) → {"name": "아메리카노", "price": 4500, "category": "커피"}
                                        imageUrl이 None이라 제외됨 → Prisma가 DB 기본값 사용
```

#### PUT — 메뉴 수정

```python
@router.put("/{menu_id}")
async def update_menu(menu_id: str, body: MenuUpdate):
    db = get_db()
    menu = await db.menu.find_unique(where={"id": menu_id})
    if not menu:
        raise HTTPException(404, "Menu not found")
    updated = await db.menu.update(
        where={"id": menu_id},
        data=body.model_dump(exclude_none=True),
    )
    return updated
```

- `/{menu_id}` — URL 경로에서 메뉴 ID를 받음 (예: `PUT /api/menus/abc123`)
- 먼저 존재하는지 확인 → 없으면 404
- `exclude_none=True`이므로 보낸 필드만 업데이트됨

```
PUT /api/menus/abc123  body: {"price": 5000}

model_dump(exclude_none=True) → {"price": 5000}
                                  name, category는 None이라 제외
                                  → 가격만 바뀌고 나머지는 그대로
```

#### DELETE — 메뉴 삭제 (soft delete)

```python
@router.delete("/{menu_id}")
async def delete_menu(menu_id: str):
    db = get_db()
    menu = await db.menu.find_unique(where={"id": menu_id})
    if not menu:
        raise HTTPException(404, "Menu not found")
    updated = await db.menu.update(
        where={"id": menu_id},
        data={"isAvailable": False},   # 실제 삭제가 아닌 비활성화
    )
    return updated
```

- DB에서 실제로 삭제(DELETE)하지 않고 `isAvailable=False`로 변경
- GET 목록에서 `where={"isAvailable": True}` 조건 때문에 자동으로 숨겨짐
- 이미 이 메뉴를 참조하는 `OrderItem`이 있어도 문제없음

### Step 3-2. 시드 데이터 스크립트

**파일:** `backend/prisma/seed.py`

```python
import asyncio
from prisma import Prisma

SEED_MENUS = [
    {"name": "아메리카노", "price": 4500, "category": "커피"},
    {"name": "카페라떼", "price": 5000, "category": "커피"},
    {"name": "바닐라라떼", "price": 5500, "category": "커피"},
    {"name": "녹차라떼", "price": 5500, "category": "음료"},
    {"name": "초코라떼", "price": 5500, "category": "음료"},
    {"name": "딸기스무디", "price": 6000, "category": "음료"},
    {"name": "크로와상", "price": 3500, "category": "베이커리"},
    {"name": "치즈케이크", "price": 6500, "category": "베이커리"},
]

async def main():
    db = Prisma()
    await db.connect()

    for menu in SEED_MENUS:
        await db.menu.create(data=menu)
        print(f"  Created: {menu['name']}")

    print(f"\nSeeded {len(SEED_MENUS)} menus.")
    await db.disconnect()

asyncio.run(main())
```

**왜 시드 데이터가 필요한가?**

- 프론트엔드 개발 시 빈 화면이 아닌 실제 메뉴를 보면서 작업 가능
- API 수동 테스트를 바로 할 수 있다

```bash
cd backend && python prisma/seed.py
```

### Step 3-3. 주문 서비스 (비즈니스 로직)

**파일:** `backend/app/services/order_service.py`

이 파일이 이 단계의 **핵심**이다. 라우터에 로직을 직접 쓰지 않고 서비스로 분리하는 이유:

- 라우터는 "HTTP 요청을 받아서 서비스를 호출하고 응답을 보내는 것"만 담당
- 비즈니스 로직이 서비스에 있으면 **테스트가 쉽다** (HTTP 없이 직접 호출 가능)

```python
class OrderService:
    def __init__(self, db: Prisma):
        self.db = db
```

#### `create_order(items, idempotency_key)`

핵심 로직 순서:

1. **메뉴 존재 확인** — 각 item의 `menu_id`로 메뉴 조회. 없으면 404
2. **가격 계산** — `menu.price × quantity`의 합산 → `totalAmount`
3. **주문 생성** — `Order` 레코드 + `OrderItem` 레코드들을 **트랜잭션**으로 생성

```python
async def create_order(self, items, idempotency_key):
    # 1. 메뉴 조회 + 가격 합산
    total = 0
    order_items_data = []
    for item in items:
        menu = await self.db.menu.find_unique(where={"id": item.menu_id})
        if not menu or not menu.isAvailable:
            raise HTTPException(404, f"Menu not found: {item.menu_id}")
        total += menu.price * item.quantity
        order_items_data.append({
            "menuId": item.menu_id,
            "quantity": item.quantity,
            "price": menu.price,        # ← 주문 시점 가격 스냅샷!
        })

    # 2. 주문 + 주문항목 일괄 생성
    order = await self.db.order.create(
        data={
            "totalAmount": total,
            "idempotencyKey": idempotency_key,
            "items": {"create": order_items_data},
        },
        include={"items": {"include": {"menu": True}}},
    )
    return order
```

**왜 `price: menu.price` 스냅샷을 저장하나?**

- 내일 아메리카노 가격이 4500 → 5000으로 오르면?
- 오늘 주문한 고객의 금액이 소급 변경되면 안 됨
- `OrderItem.price`에 주문 시점 가격을 박아넣어 불변성 보장

#### `get_orders(status?)`

```python
async def get_orders(self, status=None):
    where = {}
    if status:
        where["status"] = status
    return await self.db.order.find_many(
        where=where,
        include={"items": {"include": {"menu": True}}, "payment": True},
        order={"createdAt": "desc"},
    )
```

#### `get_order(order_id)`

```python
async def get_order(self, order_id):
    order = await self.db.order.find_unique(
        where={"id": order_id},
        include={"items": {"include": {"menu": True}}, "payment": True},
    )
    if not order:
        raise HTTPException(404, "Order not found")
    return order
```

#### `cancel_order(order_id)`

```python
async def cancel_order(self, order_id):
    order = await self.get_order(order_id)
    if order.status not in ["PENDING", "PAYMENT_PENDING"]:
        raise HTTPException(400, f"Cannot cancel order in {order.status} status")
    return await self.db.order.update(
        where={"id": order_id},
        data={"status": "CANCELLED"},
    )
```

**왜 `PAID` 상태는 취소 불가?**

- 이미 결제된 주문은 "취소"가 아니라 "환불" 절차가 필요 (Toss API 호출)
- 단순 상태 변경이 아니므로 별도 플로우로 처리해야 안전

### Step 3-4. 주문 라우터

**파일:** `backend/app/routers/orders.py`

```python
router = APIRouter(prefix="/api/orders", tags=["orders"])
```

| 메서드                          | 경로                                      | 설명                      |
| ------------------------------- | ----------------------------------------- | ------------------------- |
| `POST /api/orders`              | 주문 생성 — `Idempotency-Key` 헤더 + body | 장바구니 → 주문 변환      |
| `GET /api/orders`               | 주문 목록 — `?status=PAID` 쿼리 파라미터  | 관리자/POS 조회           |
| `GET /api/orders/{id}`          | 주문 상세                                 | 주문 + 항목 + 결제 정보   |
| `PATCH /api/orders/{id}/cancel` | 주문 취소                                 | PENDING/PAYMENT_PENDING만 |

**필요한 import:**

```python
from fastapi import APIRouter, Header, Query
from app.db.client import get_db
from app.models.schemas import OrderCreate
from app.services.order_service import OrderService
```

- `Header` — HTTP 헤더에서 값을 추출 (`Idempotency-Key`)
- `Query` — URL 쿼리 파라미터에서 값을 추출 (`?status=PAID`)
- `OrderCreate` — `schemas.py`에 정의된 요청 스키마
- `OrderService` — 비즈니스 로직을 담당하는 서비스 클래스

#### POST — 주문 생성

```python
@router.post("", status_code=201)
async def create_order(
    body: OrderCreate,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    db = get_db()
    service = OrderService(db)
    order = await service.create_order(
        items=body.items,
        idempotency_key=body.idempotency_key,
    )
    return order
```

- `Header(alias="Idempotency-Key")` — HTTP 헤더에서 `Idempotency-Key` 값을 꺼냄
- 라우터는 요청을 받아서 서비스에 위임만 하고, 비즈니스 로직은 `OrderService`에 있음

**왜 `Idempotency-Key`를 Header로도 받나?**

- body에도 `idempotency_key`가 있지만, 헤더에도 보내는 이유:
- 멱등성 미들웨어(Phase 8)는 **모든 POST 요청**의 헤더를 검사
- 미들웨어는 body를 파싱하지 않고 헤더만 본다 (효율성)

#### GET — 주문 목록 조회

```python
@router.get("")
async def list_orders(status: str | None = Query(None)):
    db = get_db()
    service = OrderService(db)
    return await service.get_orders(status=status)
```

- `Query(None)` — `?status=PAID` 쿼리 파라미터를 선택적으로 받음
- status를 안 보내면 전체 주문, 보내면 해당 상태만 필터링

```
GET /api/orders              → 전체 주문
GET /api/orders?status=PAID  → 결제 완료 주문만
```

#### GET — 주문 상세 조회

```python
@router.get("/{order_id}")
async def get_order(order_id: str):
    db = get_db()
    service = OrderService(db)
    return await service.get_order(order_id)
```

- `/{order_id}` — URL 경로에서 주문 ID를 받음 (예: `GET /api/orders/abc123`)
- 주문 + 주문항목(메뉴 이름 포함) + 결제 정보를 한 번에 반환

#### PATCH — 주문 취소

```python
@router.patch("/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    db = get_db()
    service = OrderService(db)
    return await service.cancel_order(order_id)
```

- PENDING 또는 PAYMENT_PENDING 상태일 때만 취소 가능
- 이미 결제된(PAID) 주문은 환불 절차가 별도로 필요하므로 여기서 거부

### Step 3-5. main.py에 라우터 등록

**파일:** `backend/app/main.py`에 추가

```python
from app.routers import menus, orders

app.include_router(menus.router)
app.include_router(orders.router)
```

**`include_router`가 하는 일:**

- 라우터에 정의된 모든 엔드포인트를 앱에 등록
- `prefix`가 이미 라우터에 지정되어 있으므로 여기선 생략

### Step 3-6. 시드 데이터 투입 후 API 테스트

```bash
# 1. 시드 실행
cd backend && python prisma/seed.py

# 2. 서버 실행
uvicorn app.main:app --reload

# 3. 메뉴 조회
curl http://localhost:8000/api/menus | python -m json.tool

# 4. 주문 생성
curl -X POST http://localhost:8000/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-001" \
  -d '{
    "items": [{"menu_id": "<메뉴ID>", "quantity": 2}],
    "idempotency_key": "test-key-001"
  }'

# 5. 주문 목록
curl http://localhost:8000/api/orders | python -m json.tool
```

---

## 검증 체크리스트

- [ ] **시드 데이터 확인**

  ```bash
  curl http://localhost:8000/api/menus
  # → 8개 메뉴 반환 (아메리카노, 카페라떼, ...)
  ```

- [ ] **주문 생성 확인**

  ```bash
  # 메뉴 ID를 위 응답에서 복사해서 사용
  curl -X POST http://localhost:8000/api/orders \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: test-$(date +%s)" \
    -d '{"items": [{"menu_id": "ID_HERE", "quantity": 2}], "idempotency_key": "test-key"}'
  # → 201 + 주문 데이터 반환 (totalAmount = menu.price × 2)
  ```

- [ ] **가격 스냅샷 확인**
  - 주문 응답의 `items[0].price`가 메뉴의 현재 가격과 동일한지 확인

- [ ] **주문 목록 조회**

  ```bash
  curl http://localhost:8000/api/orders
  # → 생성한 주문이 목록에 포함
  ```

- [ ] **주문 상세 조회**

  ```bash
  curl http://localhost:8000/api/orders/<ORDER_ID>
  # → items, payment 정보 포함
  ```

- [ ] **주문 취소**

  ```bash
  curl -X PATCH http://localhost:8000/api/orders/<ORDER_ID>/cancel \
    -H "Idempotency-Key: cancel-test-001"
  # → status가 "CANCELLED"로 변경
  ```

- [ ] **존재하지 않는 메뉴 → 에러**

  ```bash
  curl -X POST http://localhost:8000/api/orders \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: error-test" \
    -d '{"items": [{"menu_id": "nonexistent", "quantity": 1}], "idempotency_key": "error-test"}'
  # → 404 에러
  ```

- [ ] **Swagger에서 확인**
  - `http://localhost:8000/docs` → 메뉴, 주문 엔드포인트 모두 표시

---

## 다음 단계

→ **Phase 4**: 프론트엔드 기반 구축. 백엔드 API가 준비되었으니, 프론트엔드에서 이 API를 호출할 수 있는 인프라를 세운다.
