# Phase 3 구현 시 발생한 버그 — 들여쓰기와 import 누락

---

## 버그 1: 클래스 메서드의 들여쓰기 오류

### 잘못된 코드

```python
class OrderService:
    def __init__(self, db: Prisma):
        self.db = db

    async def create_order(self, items, idempotency_key):
    # 이 줄부터 들여쓰기가 안 됨
    total = 0
    order_items_data = []
    for item in items:
        menu = await self.db.menu.find_unique(where={"id": item.menu_id})
```

### 파이썬이 이걸 어떻게 해석하는가

```
class OrderService:
    def __init__(self, db):     ← 클래스 안 (들여쓰기 1단계)
        self.db = db            ← __init__ 안 (들여쓰기 2단계)

    async def create_order(...):  ← 클래스 안 (들여쓰기 1단계) ✅
    total = 0                     ← 들여쓰기 0단계 = 클래스 밖! ❌
    order_items_data = []         ← 클래스 밖!
    for item in items:            ← 클래스 밖!
```

파이썬은 **들여쓰기로 코드 블록을 구분**한다. `async def create_order` 선언은 클래스 안에 있지만, 그 본문이 들여쓰기되지 않으면 클래스 밖의 별도 코드로 인식된다.

### 올바른 코드

```python
class OrderService:
    def __init__(self, db: Prisma):
        self.db = db

    async def create_order(self, items, idempotency_key):
        # 메서드 본문은 반드시 한 단계 더 들여쓰기
        total = 0
        order_items_data = []
        for item in items:
            menu = await self.db.menu.find_unique(where={"id": item.menu_id})
```

### 들여쓰기 규칙 정리

```
클래스 선언       → 들여쓰기 0단계
  메서드 선언     → 들여쓰기 1단계 (4칸)
    메서드 본문   → 들여쓰기 2단계 (8칸)
      if/for 내부 → 들여쓰기 3단계 (12칸)
```

```python
class OrderService:                          # 0단계
    def __init__(self, db):                  # 1단계 (4칸)
        self.db = db                         # 2단계 (8칸)

    async def create_order(self, items):     # 1단계 (4칸)
        total = 0                            # 2단계 (8칸)
        for item in items:                   # 2단계 (8칸)
            menu = await self.db.menu...     # 3단계 (12칸)
            if not menu:                     # 3단계 (12칸)
                raise HTTPException(404)     # 4단계 (16칸)
```

### 왜 이 에러가 발생했나

phase-03.md의 코드 예시가 클래스 전체가 아닌 **메서드 본문만** 보여줬기 때문이다:

```python
# phase-03.md에서 보여준 코드 (클래스 컨텍스트 없이 메서드 본문만)
async def create_order(self, items, idempotency_key):
    total = 0
    order_items_data = []
```

이걸 클래스 안에 넣을 때 **본문의 들여쓰기를 한 단계 더 추가**해야 했는데, 그대로 복사-붙여넣기하면 들여쓰기가 맞지 않게 된다.

---

## 버그 2: import 누락

### 잘못된 코드

```python
# 파일 상단에 import가 없음
class OrderService:
    def __init__(self, db: Prisma):    # ← Prisma가 뭔지 모름
        self.db = db

    async def create_order(self, ...):
        raise HTTPException(404, ...)  # ← HTTPException이 뭔지 모름
```

### 에러 메시지

```
NameError: name 'Prisma' is not defined
NameError: name 'HTTPException' is not defined
```

파이썬은 **파일 안에서 사용하는 모든 이름을 어딘가에서 정의하거나 import해야** 한다.

### 올바른 코드

```python
from fastapi import HTTPException   # ← HTTPException을 fastapi에서 가져옴
from prisma import Prisma           # ← Prisma를 prisma에서 가져옴


class OrderService:
    def __init__(self, db: Prisma):    # ← 이제 Prisma를 알고 있음
        self.db = db
```

### import가 필요한 이유

```
파이썬이 파일을 실행할 때:

1) 파일 상단부터 한 줄씩 읽음
2) from fastapi import HTTPException  → "HTTPException이라는 이름을 알겠다"
3) from prisma import Prisma          → "Prisma라는 이름을 알겠다"
4) class OrderService:                → 클래스 정의 시작
5)     def __init__(self, db: Prisma) → Prisma? 위에서 import했으니 알겠다 ✅

import 없이:
1) 파일 상단부터 한 줄씩 읽음
2) class OrderService:                → 클래스 정의 시작
3)     def __init__(self, db: Prisma) → Prisma? 처음 보는 이름인데? ❌ NameError!
```

---

## 버그 3: 주문번호 채번 로직 누락

### 문제

Order 스키마에 `orderNumber Int @unique`가 필수 필드인데, `create_order`에서 이 값을 안 넣었다.

```python
# 누락된 코드
order = await self.db.order.create(
    data={
        # "orderNumber" 가 없음! → DB 에러 발생
        "totalAmount": total,
        "idempotencyKey": idempotency_key,
        "items": {"create": order_items_data},
    },
)
```

### 왜 필요한가

```
Prisma 스키마:
  orderNumber  Int  @unique    ← 기본값(@default)이 없음 = 필수!

SQLite는 id가 아닌 필드에 autoincrement를 지원하지 않으므로
코드에서 직접 번호를 매겨야 한다.
```

### 해결: 마지막 주문번호를 조회해서 +1

```python
# 가장 큰 orderNumber를 가진 주문을 찾음
last_order = await self.db.order.find_first(order={"orderNumber": "desc"})

# 있으면 +1, 없으면 1부터 시작
next_number = (last_order.orderNumber + 1) if last_order else 1

order = await self.db.order.create(
    data={
        "orderNumber": next_number,   # ← 이제 포함됨
        "totalAmount": total,
        "idempotencyKey": idempotency_key,
        "items": {"create": order_items_data},
    },
)
```

```
DB 상태:                        코드 동작:

주문이 0개일 때:
  last_order = None
  next_number = 1               → 주문#1 생성

주문이 3개일 때 (1, 2, 3):
  last_order = Order(orderNumber=3)
  next_number = 3 + 1 = 4      → 주문#4 생성
```
