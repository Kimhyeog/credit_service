# Prisma `find_many()` 상세 분석 — `get_orders` 예제

---

## 원본 코드

```python
return await self.db.order.find_many(
    where=where,
    include={"items": {"include": {"menu": True}}, "payment": True},
    order={"createdAt": "desc"},
)
```

이 한 덩어리가 하는 일을 인자별로 쪼개본다.

---

## 1. `self.db.order.find_many(...)`

```
self.db    →  Prisma 클라이언트 (DB 연결 객체)
  .order   →  Order 테이블을 대상으로
  .find_many()  →  여러 행을 조회 (SELECT)
```

```
Python                          SQL 대응
─────────────────               ─────────────────
db.order.find_many()     →     SELECT * FROM Order
db.order.find_first()    →     SELECT * FROM Order LIMIT 1
db.order.create()        →     INSERT INTO Order
db.order.update()        →     UPDATE Order
db.order.delete()        →     DELETE FROM Order
```

---

## 2. `where=where`

조건 필터. `where` 딕셔너리의 내용에 따라 SQL `WHERE`절이 달라진다.

```python
where = {}                    # → SELECT * FROM Order (전체)
where = {"status": "PAID"}    # → SELECT * FROM Order WHERE status = 'PAID'
```

더 복잡한 조건도 가능하다:

```python
# 여러 조건 AND
where = {"status": "PAID", "totalAmount": {"gte": 10000}}
# → WHERE status = 'PAID' AND totalAmount >= 10000

# OR 조건
where = {"OR": [{"status": "PAID"}, {"status": "CANCELLED"}]}
# → WHERE status = 'PAID' OR status = 'CANCELLED'
```

---

## 3. `include` — 관계 데이터 함께 가져오기

이것이 가장 핵심이다. **관계된 테이블 데이터를 함께 가져오라**는 지시인데, 2단계 중첩이 있다.

### 구조를 풀어 쓰면

```python
include = {
    "items": {                  # ← Order → OrderItem (1:N 관계)
        "include": {
            "menu": True        # ← OrderItem → Menu (N:1 관계)
        }
    },
    "payment": True             # ← Order → Payment (1:1 관계)
}
```

```
스키마 관계도:

Order ──1:N──► OrderItem ──N:1──► Menu
  │
  └──1:1──► Payment
```

### include가 없으면

```python
order = await db.order.find_many()
print(order[0].items)      # 에러! items 필드가 로드되지 않음
print(order[0].payment)    # 에러! payment 필드가 로드되지 않음
```

```
┌────────────────────────┐
│ Order                  │
│   id: "abc"            │
│   status: "PAID"       │
│   totalAmount: 14500   │
│   items: ❌ 없음       │
│   payment: ❌ 없음     │
└────────────────────────┘
```

### `"payment": True`만 있으면

```python
include = {"payment": True}
```

```
┌────────────────────────┐
│ Order                  │
│   id: "abc"            │
│   status: "PAID"       │
│   items: ❌ 없음       │    ← items는 include 안 했으므로 없음
│   payment:             │
│     ┌────────────────┐ │
│     │ status: "DONE" │ │    ← payment만 로드됨
│     │ amount: 14500  │ │
│     └────────────────┘ │
└────────────────────────┘
```

### `"items": True`만 있으면 (menu 없이)

```python
include = {"items": True}
```

```
┌─────────────────────────────┐
│ Order                       │
│   items: [                  │
│     ┌─────────────────────┐ │
│     │ OrderItem           │ │
│     │   quantity: 2       │ │
│     │   price: 4500       │ │
│     │   menuId: "m_001"   │ │
│     │   menu: ❌ 없음     │ │  ← 메뉴 "이름"을 모름, ID만 있음
│     └─────────────────────┘ │
│   ]                         │
│   payment: ❌ 없음          │
└─────────────────────────────┘
```

### `"items": {"include": {"menu": True}}`이면 (2단계 중첩)

```python
include = {"items": {"include": {"menu": True}}}
```

```
┌──────────────────────────────────┐
│ Order                            │
│   items: [                       │
│     ┌──────────────────────────┐ │
│     │ OrderItem                │ │
│     │   quantity: 2            │ │
│     │   price: 4500            │ │
│     │   menu:                  │ │
│     │     ┌──────────────────┐ │ │
│     │     │ name: "아메리카노"│ │ │  ← 메뉴 이름까지 가져옴!
│     │     │ category: "커피" │ │ │
│     │     └──────────────────┘ │ │
│     └──────────────────────────┘ │
│   ]                              │
└──────────────────────────────────┘
```

**이게 왜 필요한가:** 프론트엔드에서 주문 목록을 보여줄 때 "아메리카노 x 2"처럼 **메뉴 이름**이 필요하다. `include`로 menu까지 안 가져오면 menuId만 있고 이름을 모른다.

### 실제로 Prisma가 보내는 쿼리

```
include 하나당 SELECT 하나:

  1) SELECT * FROM Order WHERE ...                    ← order
  2) SELECT * FROM OrderItem WHERE orderId IN (...)   ← items
  3) SELECT * FROM Menu WHERE id IN (...)             ← items 안의 menu
  4) SELECT * FROM Payment WHERE orderId IN (...)     ← payment

Prisma가 4개 쿼리 결과를 조립 → 중첩된 파이썬 객체로 반환
```

---

## 4. `order={"createdAt": "desc"}`

정렬 기준. SQL의 `ORDER BY`에 대응한다.

```python
order={"createdAt": "desc"}   # → ORDER BY createdAt DESC (최신 먼저)
order={"createdAt": "asc"}    # → ORDER BY createdAt ASC  (오래된 것 먼저)
order={"totalAmount": "desc"} # → ORDER BY totalAmount DESC (비싼 것 먼저)
```

```
desc (내림차순):              asc (오름차순):
  주문#103  14:00  ← 최신      주문#101  12:00  ← 오래된 것
  주문#102  13:30              주문#102  13:30
  주문#101  12:00              주문#103  14:00
```

POS 화면에서는 **최신 주문이 위에** 와야 하므로 `desc`를 쓴다.

---

## 5. 전체 흐름 종합

```
get_orders(status="PAID") 호출
    │
    ▼
  where = {"status": "PAID"}
    │
    ▼
  db.order.find_many(
      where={"status": "PAID"},        ← PAID 주문만
      include={
          "items": {                    ← 주문 항목도
              "include": {"menu": True} ← 메뉴 이름도
          },
          "payment": True              ← 결제 정보도
      },
      order={"createdAt": "desc"},     ← 최신 먼저
  )
    │
    ▼                              SQLite
  쿼리 1: Order 조회         ──►   2건 발견
  쿼리 2: OrderItem 조회     ──►   5건 발견
  쿼리 3: Menu 조회          ──►   3건 발견
  쿼리 4: Payment 조회       ──►   2건 발견
    │
    ▼
  Prisma가 조립해서 반환:
  [
    Order(
      id="abc", status="PAID", totalAmount=14500,
      items=[
        OrderItem(qty=2, price=4500, menu=Menu(name="아메리카노")),
        OrderItem(qty=1, price=5500, menu=Menu(name="바닐라라떼")),
      ],
      payment=Payment(status="DONE", amount=14500, method="CARD"),
    ),
    Order(...),
  ]
```
