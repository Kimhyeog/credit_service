# `async def` vs `def`, 그리고 `asyncio.run()`

---

## 1. 일반 함수 vs 코루틴 함수

### 일반 함수 (`def`)

```python
def greet():
    return "안녕"

result = greet()   # 즉시 실행, result = "안녕"
```

```
greet() 호출
    │
    ▼
  return "안녕"  ──► result = "안녕"
    │
   끝
```

호출하면 **바로 실행**되고, 반환값이 나온다.

### 코루틴 함수 (`async def`)

```python
async def greet():
    return "안녕"

result = greet()   # 실행 안 됨! 코루틴 객체만 생성
print(result)      # <coroutine object greet at 0x...>
```

```
greet() 호출
    │
    ▼
  코루틴 객체 생성 (함수 본문은 아직 실행되지 않음)
    │
    ▼
  result = <coroutine object>   ← 문자열 "안녕"이 아님!
```

`async def`는 **"나는 중간에 멈출 수 있는 함수야"라는 선언**이다. 호출해도 본문이 실행되지 않고, 코루틴 객체만 반환된다.

### 나란히 비교

```
┌──────────────────────────┬──────────────────────────────────┐
│      def greet()         │      async def greet()           │
├──────────────────────────┼──────────────────────────────────┤
│  greet()                 │  greet()                         │
│    → 즉시 실행           │    → 코루틴 객체만 생성          │
│    → "안녕" 반환         │    → 실행하려면 await 또는       │
│                          │      asyncio.run() 필요          │
└──────────────────────────┴──────────────────────────────────┘
```

---

## 2. `await`가 하는 일

`await`는 **"이 작업이 끝날 때까지 기다려, 기다리는 동안 다른 일 해도 돼"**라는 의미다.

```python
async def make_order():
    print("1. 주문 시작")
    result = await db.order.create(data={...})   # DB에 INSERT
    print("2. 주문 완료")
    return result
```

```
make_order() 실행
    │
    ▼
  print("1. 주문 시작")         ← 즉시 실행
    │
    ▼
  await db.order.create(...)
    │
    ├── DB에 INSERT 요청 보냄
    │
    ├── ⏸️  응답 올 때까지 이 함수는 일시 중단
    │       (이 틈에 다른 코루틴이 실행될 수 있음)
    │
    ◄── DB 응답 도착, 재개
    │
    ▼
  print("2. 주문 완료")         ← DB 작업 끝난 후 실행
```

핵심: `await` 없이 그냥 `def`로 DB 호출을 하면, **응답이 올 때까지 프로그램 전체가 멈춘다** (블로킹). `await`는 기다리는 동안 다른 요청을 처리할 수 있게 해준다.

---

## 3. 동기 vs 비동기 — 카페 비유

### 동기 (`def`) — 직원 1명, 한 번에 하나만

```
직원
  │
  ├─ 손님A 주문 받기
  ├─ 손님A 커피 내리기 (3분 대기... 아무것도 못 함)
  ├─ 손님A 커피 전달
  │
  ├─ 손님B 주문 받기        ← 손님B는 A 끝날 때까지 기다림
  ├─ 손님B 커피 내리기 (3분 대기...)
  ├─ 손님B 커피 전달
```

```python
def handle_customer(name):
    order = take_order(name)          # 블로킹
    coffee = brew_coffee(order)       # 3분 블로킹
    deliver(name, coffee)

handle_customer("A")   # A 끝날 때까지
handle_customer("B")   # B는 시작도 못 함
```

### 비동기 (`async def`) — 직원 1명, 기다리는 동안 다른 손님 처리

```
직원
  │
  ├─ 손님A 주문 받기
  ├─ 손님A 커피 내리기 시작 (머신에 맡김)
  │     │
  │     ├─ ⏸️ 커피 나올 때까지 A는 대기
  │     │
  ├─ 손님B 주문 받기        ← 기다리는 틈에 B 처리!
  ├─ 손님B 커피 내리기 시작
  │     │
  ◄─ 손님A 커피 완성! → A에게 전달
  ◄─ 손님B 커피 완성! → B에게 전달
```

```python
async def handle_customer(name):
    order = take_order(name)
    coffee = await brew_coffee(order)   # 기다리는 동안 다른 코루틴 실행 가능
    deliver(name, coffee)
```

---

## 4. `asyncio.run()`의 역할

코루틴은 혼자 실행될 수 없다. **이벤트 루프**라는 실행기가 필요하다.

```
asyncio.run(main())이 하는 3가지:

  1. 이벤트 루프 생성       ← 코루틴들을 관리할 "관리자" 생성
  2. main() 코루틴 실행     ← main 안의 await를 만나면 멈추고/재개 반복
  3. main() 끝나면 루프 종료 ← 정리
```

```python
import asyncio

async def main():
    print("시작")
    await some_async_work()
    print("끝")

# 이렇게 하면 안 됨:
main()          # 코루틴 객체만 생성, 실행 안 됨

# 이렇게 해야 함:
asyncio.run(main())   # 이벤트 루프가 main()을 실제로 실행
```

```
asyncio.run(main())
    │
    ▼
┌─────────────────────────────────┐
│  이벤트 루프 생성                │
│                                  │
│  main() 코루틴 등록 → 실행 시작  │
│    │                             │
│    ├─ print("시작")              │
│    ├─ await some_async_work()    │
│    │    └─ I/O 대기 중...        │
│    │       (루프가 다른 일 처리)  │
│    │    └─ 완료, main 재개       │
│    ├─ print("끝")                │
│    └─ return                     │
│                                  │
│  main() 끝남 → 루프 종료         │
└─────────────────────────────────┘
```

### seed.py에서의 흐름

```python
asyncio.run(main())
```

```
asyncio.run(main())
    │
    ▼
┌── 이벤트 루프 ──────────────────────────────────────┐
│                                                      │
│  await db.connect()          ──► dev.db 연결         │
│      │                                               │
│  for문 1회차:                                        │
│      await db.menu.create(아메리카노)                │
│          ├─ INSERT 전송 ──► SQLite                   │
│          ◄─ OK ────────────                          │
│      print("Created: 아메리카노")                    │
│      │                                               │
│  for문 2회차:                                        │
│      await db.menu.create(카페라떼)                  │
│          ├─ INSERT 전송 ──► SQLite                   │
│          ◄─ OK ────────────                          │
│      print("Created: 카페라떼")                      │
│      │                                               │
│      ... (8회 반복) ...                               │
│      │                                               │
│  await db.disconnect()       ──► 연결 종료           │
│                                                      │
└── 루프 종료 ────────────────────────────────────────┘
```

---

## 5. `async def`를 써야 하는 대표적인 상황

### 상황 1: 데이터베이스 쿼리

```python
# DB 응답 대기 시간에 다른 요청 처리 가능
async def get_menus():
    return await db.menu.find_many(where={"isAvailable": True})
```

### 상황 2: 외부 API 호출

```python
# Toss 결제 승인 API — 네트워크 왕복 시간 동안 서버가 멈추면 안 됨
async def confirm_payment(payment_key: str, order_id: str, amount: int):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.tosspayments.com/v1/payments/confirm",
            json={"paymentKey": payment_key, "orderId": order_id, "amount": amount},
        )
    return response.json()
```

### 상황 3: 파일 읽기/쓰기

```python
import aiofiles

async def read_config():
    async with aiofiles.open("config.json", "r") as f:
        content = await f.read()
    return content
```

### 상황 4: 여러 작업 동시 실행

```python
import asyncio

async def dashboard_data():
    # 3개 쿼리를 동시에 실행 — 가장 느린 것 하나만큼만 기다림
    orders, payments, menus = await asyncio.gather(
        db.order.find_many(),
        db.payment.find_many(),
        db.menu.find_many(),
    )
    return {"orders": orders, "payments": payments, "menus": menus}
```

```
동기 (순차):                    비동기 (동시):
  orders   ███░░░░░░ 300ms       orders   ███░░░░░░
  payments ░░░████░░ 400ms       payments ████░░░░░
  menus    ░░░░░░░██ 200ms       menus    ██░░░░░░░
  합계: 900ms                    합계: 400ms (가장 긴 것 하나)
```

### 상황 5: FastAPI 라우터

```python
# FastAPI는 async def 라우터를 이벤트 루프에서 실행
# → 동시에 수십~수백 요청 처리 가능
@router.post("/api/orders")
async def create_order(body: OrderCreate):
    order = await order_service.create(body)
    return order
```

### `async def`가 필요 없는 경우

```python
# 단순 계산, 문자열 처리 등 I/O가 없는 작업
def calculate_total(items):
    return sum(item.price * item.quantity for item in items)

# 동기 라이브러리만 쓰는 경우
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt())
```

> **기준:** I/O 대기(네트워크, DB, 파일)가 있으면 `async def`, 순수 계산이면 `def`.

---

## 6. 이 프로젝트에서의 사용 패턴 정리

| 파일 | `asyncio.run()` 필요? | 이유 |
|------|----------------------|------|
| `seed.py` | O | 독립 스크립트, 이벤트 루프를 직접 만들어야 함 |
| FastAPI 라우터 | X | Uvicorn이 이벤트 루프를 이미 돌리고 있음, `async def`만 쓰면 됨 |
| 테스트 (`pytest-asyncio`) | X | `@pytest.mark.asyncio`가 루프를 자동 관리 |

```
독립 스크립트:   asyncio.run(main())  →  루프 생성 → 실행 → 종료
FastAPI 서버:    uvicorn이 루프 관리  →  async def 라우터를 자동 실행
테스트:          pytest-asyncio       →  async def 테스트를 자동 실행
```

`asyncio.run()`을 직접 쓰는 경우는 **독립 스크립트뿐**이다. 서버/테스트에서는 프레임워크가 대신 해준다.
