# Prisma 클라이언트 초기화란? — 앱 전체가 DB와 대화하는 단 하나의 통로

> Phase 2 Step 2-3 `backend/app/db/client.py` 관련 설명

---

## 한 줄 요약

DB 커넥션을 **앱 전체에서 하나만** 만들고, **함수로 감싸서** 꺼내 쓰게 하는 것이다.

---

## 전체 코드 (5줄)

```python
from prisma import Prisma

db = Prisma()              # ① 전역 인스턴스

def get_db() -> Prisma:    # ② 접근 함수
    return db
```

단 5줄이지만 두 가지 설계 판단이 들어있다:

1. **왜 `db = Prisma()`를 모듈 최상위(전역)에 두는가?**
2. **왜 `get_db()` 함수로 한 번 감싸는가?**

아래에서 하나씩 살펴본다.

---

## 1. 전역 인스턴스 — `db = Prisma()`

### 이것이 하는 일

Prisma 클라이언트는 내부에 **커넥션 풀(connection pool)**을 갖고 있다.
커넥션 풀이란 DB와 미리 연결해둔 통로 여러 개를 묶어 놓은 것이다.

```
Prisma 클라이언트 (db)
┌─────────────────────────────┐
│        Connection Pool      │
│  ┌─────┐ ┌─────┐ ┌─────┐    │
│  │conn1│ │conn2│ │conn3│    │     ←──→  SQLite / PostgreSQL
│  └─────┘ └─────┘ └─────┘    │
│      (미리 열어둔 통로들)        │
└─────────────────────────────┘
```

요청이 오면 풀에서 빈 커넥션을 빌려 쓰고, 끝나면 반납한다.
**새로 여는 게 아니라 재활용**하는 것이다.

---

### 커넥션 풀을 왜 쓰는가? — 식당 주방 비유

이해하기 쉽게 **식당 주방**으로 비유해보자.

DB 커넥션 = 주방과 홀을 연결하는 **서빙 통로**라고 생각하면 된다.

---

#### 커넥션 풀 없는 경우: 손님마다 통로를 새로 만드는 식당

```
손님 1 주문 → 통로 공사 시작 (3초) → 통로 완성 → 음식 전달 → 통로 철거
손님 2 주문 → 통로 공사 시작 (3초) → 통로 완성 → 음식 전달 → 통로 철거
손님 3 주문 → 통로 공사 시작 (3초) → 통로 완성 → 음식 전달 → 통로 철거

점심시간에 손님 50명이 동시에 오면?

  ┌─ 통로 공사 중... ─┐
  ├─ 통로 공사 중... ─┤
  ├─ 통로 공사 중... ─┤
  ├─     ...         ─┤
  └─ 통로 공사 중... ─┘  ← 50개 통로를 동시에 짓는 중

  → 공사 인력 부족 (CPU/메모리 소모)
  → 주방 공간 부족 (DB 커넥션 수 한계)
  → 식당 마비 (서버 다운)
```

**매번 통로를 새로 짓고 부수는 데 드는 비용:**
- TCP 연결 수립 (3-way handshake)
- DB 인증 (아이디/비밀번호 확인)
- 메모리 할당
- 사용 후 전부 정리

이걸 **요청 하나마다** 반복하면 느려질 수밖에 없다.

---

#### 커넥션 풀 있는 경우: 통로 3개를 미리 만들어 놓는 식당

```
식당 오픈 → 통로 3개 미리 설치 (1번, 2번, 3번)

손님 1 주문 → 1번 통로로 음식 전달 → 1번 통로 비워짐 (재사용 대기)
손님 2 주문 → 2번 통로로 음식 전달 → 2번 통로 비워짐
손님 3 주문 → 3번 통로로 음식 전달 → 3번 통로 비워짐
손님 4 주문 → 1번 통로 다시 사용!   ← 이미 있는 통로 재활용

  ┌─────────────────────────────────────────────┐
  │         미리 만들어 둔 통로 3개               │
  │                                              │
  │  손님1 ──→ [1번 통로] ──→ 주방              │
  │  손님2 ──→ [2번 통로] ──→ 주방              │
  │  손님3 ──→ [3번 통로] ──→ 주방              │
  │  손님4 ──→ [1번 통로] ──→ 주방  (빌려 씀!)  │
  │                                              │
  └─────────────────────────────────────────────┘

  → 통로 공사 비용 = 0 (이미 있으니까)
  → 통로 수 = 항상 3개 (DB 부담 없음)
  → 손님이 100명 와도 통로는 3개로 돌아감
```

**핵심:** 통로를 **짓는 시간을 아끼고**, 동시에 열리는 통로 **수를 통제**한다.

---

#### 코드로 보면

```python
# ❌ 커넥션 풀 없음 (손님마다 통로 공사)
async def create_order():
    db = Prisma()              # 통로 공사 시작
    await db.connect()         # 3-way handshake + 인증
    order = await db.order.create(...)   # 음식 전달
    await db.disconnect()      # 통로 철거
    return order
    # → 요청 1000개 = 통로 공사 1000번
```

```python
# ✅ 커넥션 풀 있음 (통로 3개 미리 설치)
db = Prisma()                  # 앱 시작 시 딱 1번
await db.connect()             # 통로 3개 미리 설치

async def create_order():
    order = await db.order.create(...)   # 빈 통로 빌려서 음식 전달
    return order                          # 통로 반납 (철거 안 함!)
    # → 요청 1000개 = 통로 공사 0번, 기존 통로 1000번 재활용
```

---

#### 정리

```
                    커넥션 풀 없음          커넥션 풀 있음
                    ───────────           ──────────
통로(커넥션) 생성     매 요청마다           앱 시작 시 1번
통로 수              요청 수만큼 증가       고정 (3~5개)
요청당 오버헤드      높음 (연결+인증+해제)  거의 없음 (빌려 쓰기)
동시 요청 100개       커넥션 100개 폭증     커넥션 3개로 순서대로 처리
DB 부하              심각                  안정적
```

이것이 `db = Prisma()`를 전역에 **하나만** 두는 이유다.
커넥션 풀을 한 번 만들어 두면, 앱이 종료될 때까지 계속 재활용한다.

---

### 왜 전역이어야 하는가? — 요청마다 만들면 생기는 문제

#### 나쁜 예: 요청마다 새로 만드는 경우

```python
# ❌ 잘못된 방식
async def create_order(request):
    db = Prisma()          # 요청마다 새 인스턴스
    await db.connect()     # 매번 커넥션 풀 새로 생성
    order = await db.order.create(...)
    await db.disconnect()  # 매번 정리
    return order
```

```
요청 1 → Prisma() 생성 → connect() → 커넥션 풀 생성 → 쿼리 → disconnect() → 풀 폐기
요청 2 → Prisma() 생성 → connect() → 커넥션 풀 생성 → 쿼리 → disconnect() → 풀 폐기
요청 3 → Prisma() 생성 → connect() → 커넥션 풀 생성 → 쿼리 → disconnect() → 풀 폐기
  ...

동시 요청 100개가 오면?

┌──────┐ ┌──────┐ ┌──────┐       ┌──────┐
│ Pool │ │ Pool │ │ Pool │  ...  │ Pool │   ← 100개의 커넥션 풀!
│ #1   │ │ #2   │ │ #3   │       │ #100 │
└──┬───┘ └──┬───┘ └──┬───┘       └──┬───┘
   │        │        │              │
   ▼        ▼        ▼              ▼
 ┌───────────────────────────────────────┐
 │          SQLite / PostgreSQL          │
 │                                       │
 │   커넥션 300+ 개 동시 열림             │
 │   → DB 과부하 → 느려짐 → 장애 💥     │
 └───────────────────────────────────────┘
```

매 요청마다 커넥션 풀을 만들고 부수는 건 **집에 들어갈 때마다 문을 새로 달고, 나올 때 떼어내는 것**과 같다.

---

#### 좋은 예: 전역 인스턴스 하나를 공유

```python
# ✅ 올바른 방식 (client.py)
db = Prisma()   # 모듈 로드 시 딱 한 번 생성
```

```
앱 시작 → db = Prisma() → connect() → 커넥션 풀 1개 생성

요청 1 → db.order.create(...)  ─┐
요청 2 → db.order.find_many()  ─┤── 같은 풀에서 커넥션 빌려 씀
요청 3 → db.payment.create(...) ┘

              ┌─────────────────────────────┐
              │     Prisma 클라이언트 (db)   │
              │       Connection Pool       │
              │  ┌─────┐ ┌─────┐ ┌─────┐   │
요청 1 ──────→│  │conn1│ │     │ │     │   │
요청 2 ──────→│  │     │ │conn2│ │     │   │
요청 3 ──────→│  │     │ │     │ │conn3│   │
              │  └─────┘ └─────┘ └─────┘   │
              └────────────┬────────────────┘
                           │
                           ▼
              ┌───────────────────────────┐
              │   SQLite / PostgreSQL     │
              │                           │
              │   커넥션 3개만 사용        │
              │   → 안정적 ✅             │
              └───────────────────────────┘
```

문 하나를 달아두고 모두가 같이 쓰는 것이다.

---

### "전역 인스턴스"가 만들어지는 타이밍

Python에서 `import`가 처음 실행될 때 모듈 코드가 **딱 한 번** 실행된다.

```
앱 시작
  │
  ├─ main.py 실행
  │    │
  │    ├─ from app.db.client import db    ← 이 순간!
  │    │    │
  │    │    └─ client.py가 로드됨
  │    │         │
  │    │         └─ db = Prisma()         ← 인스턴스 생성 (딱 1번)
  │    │
  │    ├─ from app.routers.orders import router
  │    │    │
  │    │    └─ orders.py에서 from app.db.client import db
  │    │         │
  │    │         └─ 이미 로드됨 → 같은 db 객체 반환  ← 새로 만들지 않음!
  │    │
  │    └─ from app.routers.payments import router
  │         │
  │         └─ payments.py에서 from app.db.client import db
  │              │
  │              └─ 이미 로드됨 → 같은 db 객체 반환  ← 역시 같은 객체!
  │
  └─ 결과: orders, payments, 모든 모듈이 동일한 db를 공유
```

Python의 모듈 시스템이 **자동으로 싱글턴(하나만 존재)**을 보장해준다.

---

## 2. 접근 함수 — `get_db()`

### 이것이 하는 일

```python
def get_db() -> Prisma:
    return db
```

"그냥 db를 리턴하는데, 이걸 왜 함수로 감싸지?" — 두 가지 이유가 있다.

---

### 이유 1: FastAPI의 `Depends()`와 결합 — 식당 알바생 비유

#### "의존성 주입"이 뭔데?

어려운 말 같지만, 실제로는 간단하다.

**의존성** = 이 함수가 일하려면 **반드시 필요한 것**
**주입** = 그걸 **밖에서 넣어주는 것**

식당 알바생으로 비유하면:

```
알바생(라우터 함수)이 주문을 처리하려면 "주방 통로(db)"가 필요하다.

방법 A: 알바생이 직접 통로를 찾아간다
방법 B: 매니저가 "이 통로 써" 하고 건네준다  ← 이게 의존성 주입
```

---

#### 방법 A: 직접 가져오기 (Depends 없이)

```python
from app.db.client import db        # 알바생이 직접 주방 통로를 찾아감

@router.post("/api/orders")
async def create_order():
    order = await db.order.create(...)   # 항상 "그 통로"만 씀
    return order
```

```
알바생이 직접 통로를 가져오는 구조:

  알바생 (create_order)
    │
    └─ "나는 db가 필요해"
        │
        └─ from app.db.client import db   ← 직접 찾아감
            │
            └─ 항상 진짜 DB

  문제: 알바생이 "어디서 뭘 가져올지" 스스로 결정함
       → 나중에 바꾸고 싶어도 알바생 코드를 고쳐야 함
```

---

#### 방법 B: 매니저가 건네주기 (Depends 사용)

```python
from fastapi import Depends
from app.db.client import get_db

@router.post("/api/orders")
async def create_order(db = Depends(get_db)):
    #                   ^^   ^^^^^^^^^^^^^^^
    #                   │    매니저(FastAPI)에게 "db 좀 줘"라고 요청
    #                   │
    #                   매니저가 get_db()를 호출해서 여기에 넣어줌
    order = await db.order.create(...)
    return order
```

```
매니저(FastAPI)가 건네주는 구조:

  요청 도착: POST /api/orders
    │
    ▼
  FastAPI (매니저):
    │
    ├─ "create_order 함수를 실행해야 하는데..."
    │
    ├─ "파라미터를 보니 db = Depends(get_db) 라고 적혀있네"
    │
    ├─ get_db() 호출 → Prisma 인스턴스가 리턴됨
    │
    └─ create_order(db=Prisma인스턴스) 실행!
         │
         └─ 알바생은 건네받은 db로 일만 하면 됨
```

**핵심:** 알바생(함수)은 **"db가 필요하다"고만 선언**하고, **어디서 가져올지는 매니저(FastAPI)가 결정**한다.

---

#### 이게 왜 좋은가? — 교체가 쉬워진다

식당 비유로 계속 가보자:

```
평일 (운영 환경):

  매니저: "오늘은 진짜 주방 통로 써"
    │
    └─ get_db() → 진짜 DB 반환
        │
        └─ 알바생은 진짜 DB로 주문 처리


일요일 연습 (테스트 환경):

  매니저: "오늘은 연습용 통로 써"
    │
    └─ get_test_db() → 테스트 DB 반환    ← 교체!
        │
        └─ 알바생은 테스트 DB로 연습

  알바생의 행동은 똑같다! (코드 변경 없음)
  바뀐 건 매니저가 건네주는 것뿐.
```

코드로 보면:

```python
# 운영: 매니저가 진짜 DB를 건네줌
#   → 아무것도 안 해도 기본 동작

# 테스트: 매니저에게 "get_db 대신 get_test_db 써"라고 지시
app.dependency_overrides[get_db] = get_test_db
#   → 알바생(라우터) 코드는 한 글자도 안 바뀜!
```

---

#### 전체 흐름 비교

```
직접 import (Depends 없이):

  알바생 ──→ 직접 db를 가져옴 ──→ 항상 진짜 DB
  알바생 ──→ 직접 db를 가져옴 ──→ 항상 진짜 DB  (테스트에서도!)
                                    │
                                    └─ 바꾸려면? 알바생 코드를 수정해야 함


Depends(get_db):

  매니저 ──→ get_db() 호출 ──→ 결과를 알바생에게 전달
    │
    ├─ 운영: get_db()     → 진짜 DB   → 알바생에게 전달
    └─ 테스트: get_test_db() → 가짜 DB → 알바생에게 전달
                                          │
                                          └─ 알바생 코드는 동일!
```

정리하면:

| | 직접 import | Depends(get_db) |
|---|---|---|
| db를 누가 결정? | 함수 자신 | FastAPI (매니저) |
| 테스트에서 교체 | 함수 코드 수정 필요 | `dependency_overrides` 한 줄 |
| 함수의 역할 | db 가져오기 + 비즈니스 로직 | 비즈니스 로직만 (깔끔) |

---

### 이유 2: 테스트에서 가짜 DB로 교체

테스트할 때 진짜 DB에 데이터를 넣고 빼면:

- 느리다 (디스크 I/O)
- 테스트끼리 데이터가 꼬인다
- CI에서 DB 서버가 필요하다

**해결:** `get_db()`가 리턴하는 것을 **테스트용 DB로 바꿔치기**한다.

```python
# tests/conftest.py

from prisma import Prisma
from app.db.client import get_db

test_db = Prisma()  # 테스트 전용 인스턴스 (in-memory SQLite 등)

def get_test_db():
    return test_db

# FastAPI 앱의 get_db를 get_test_db로 교체
app.dependency_overrides[get_db] = get_test_db
```

```
운영 환경:
┌───────────┐      get_db()       ┌──────────────┐
│  라우터   │ ──────────────────→ │  진짜 DB     │
│           │                     │  (dev.db)    │
└───────────┘                     └──────────────┘

테스트 환경:
┌───────────┐    get_test_db()    ┌──────────────┐
│  라우터   │ ──────────────────→ │  테스트 DB   │
│ (동일코드) │     (교체됨!)       │  (in-memory) │
└───────────┘                     └──────────────┘
```

라우터 코드는 **한 줄도 바꾸지 않고**, DB만 갈아끼울 수 있다.
이것이 `get_db()` 함수로 감싸는 핵심 이유다.

---

### 만약 get_db() 없이 직접 import했다면?

```python
# ❌ 라우터에서 직접 import
from app.db.client import db

@router.post("/api/orders")
async def create_order():
    order = await db.order.create(...)   # 항상 진짜 DB
    return order
```

```
테스트에서 교체하려면?

  → db는 모듈 레벨 변수라서 외부에서 바꾸기 어려움
  → monkeypatch, mock 등 복잡한 우회가 필요
  → 코드가 지저분해지고 실수하기 쉬움
```

```python
# ✅ get_db()를 통해 간접 접근
@router.post("/api/orders")
async def create_order(db = Depends(get_db)):
    order = await db.order.create(...)
    return order
```

```
테스트에서 교체하려면?

  app.dependency_overrides[get_db] = get_test_db   ← 한 줄!
  → 깔끔하고 안전
```

---

## 전체 동작 흐름

앱 시작부터 요청 처리까지 `client.py`가 어떻게 쓰이는지 한눈에 보자.

```
[앱 시작]
    │
    ▼
main.py
    │
    ├─ from app.db.client import db
    │       │
    │       └─ client.py 로드 → db = Prisma() (인스턴스 생성)
    │
    ├─ lifespan():
    │       │
    │       ├─ 앱 시작 시 → await db.connect()
    │       │                   │
    │       │                   ▼
    │       │            ┌─────────────────────┐
    │       │            │   Connection Pool    │
    │       │            │  conn1, conn2, conn3 │──→ SQLite
    │       │            └─────────────────────┘
    │       │
    │       └─ 앱 종료 시 → await db.disconnect()
    │                           │
    │                           └─ 커넥션 풀 정리, 자원 해제
    │
    └─ 라우터 등록 (orders, payments, ...)


[요청 도착]
    │
    ▼
POST /api/orders
    │
    ▼
FastAPI: "create_order의 db 파라미터에 뭘 넣지?"
    │
    ├─ Depends(get_db) 발견
    │
    ├─ get_db() 호출 → 전역 db 인스턴스 반환
    │
    └─ create_order(db=전역_db_인스턴스) 실행
         │
         ├─ await db.order.create(...)
         │       │
         │       └─ 커넥션 풀에서 빈 커넥션 빌림 → SQL 실행 → 커넥션 반납
         │
         └─ 응답 반환
```

---

## 요약: 5줄에 담긴 설계 판단

```
db = Prisma()            →  커넥션 풀을 앱 전체에서 하나만 유지
                             (성능 + 자원 관리)

def get_db() -> Prisma:  →  DB 접근을 함수로 감싸서
    return db                Depends()로 주입 가능하게 만듦
                             (테스트 교체 + 깔끔한 의존성 관리)
```

| 설계 판단       | 문제                                 | 해결                                              |
| --------------- | ------------------------------------ | ------------------------------------------------- |
| 전역 인스턴스   | 요청마다 풀 생성 → DB 과부하         | 하나만 만들어 공유                                |
| `get_db()` 함수 | 직접 import → 테스트에서 교체 어려움 | `Depends()` + `dependency_overrides`로 한 줄 교체 |
