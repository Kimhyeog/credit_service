# Phase 2. 백엔드 기반 — DB + 공통 모듈

> **목표:** Prisma 스키마 → SQLite DB 생성 → 클라이언트 초기화 → Pydantic 스키마 → FastAPI 앱 진입점
>
> **예상 소요:** 40~60분
>
> **선행 조건:** Phase 1 완료

---

## 왜 이 단계가 필요한가?

모든 API는 결국 **데이터를 저장하고 꺼내는 것**이다. DB 스키마를 먼저 확정하면 이후 모든 코드가 이 "계약"에 맞춰 자연스럽게 흘러간다. 여기서 정의하는 6개 모델(Menu, Order, OrderItem, Payment, IdempotencyRecord, WebhookEvent)이 이 프로젝트의 **데이터 뼈대**다.

---

## 구현 TODO

### Step 2-1. Prisma 스키마 작성

**파일:** `backend/prisma/schema.prisma`

```prisma
generator client {
  provider             = "prisma-client-py"
  recursive_type_depth = 5
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

**왜 `prisma-client-py`인가?**

- Prisma는 원래 Node.js용이지만, Python 클라이언트도 공식 지원
- SQL을 직접 쓰는 대신 타입 안전한 쿼리 빌더를 제공
- 스키마 하나로 DB 생성 + 마이그레이션 + 타입 생성을 모두 처리

**왜 SQLite인가?**

- 개발 환경에서는 별도 DB 서버 없이 파일 하나(`dev.db`)로 동작
- 운영 환경에서 PostgreSQL로 전환할 때 `provider`만 바꾸면 됨

이제 모델을 추가한다. 아래 모델들을 **모두 같은 `schema.prisma` 파일**에 이어서 작성한다 (generator, datasource 블록 아래에). 각 모델이 **왜** 필요한지:

#### Menu — 메뉴 테이블

```prisma
model Menu {
  id          String   @id @default(cuid())
  name        String
  price       Int                // 원 단위 (정수로 관리 → 부동소수점 오류 방지)
  category    String
  imageUrl    String?
  isAvailable Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  orderItems  OrderItem[]
}
```

- `price`를 `Int`(원 단위)로 쓰는 이유: 돈을 `Float`로 다루면 `0.1 + 0.2 = 0.30000000000000004` 같은 오류가 발생한다
- `isAvailable`: 메뉴 삭제 대신 비활성화(soft delete) — 이미 주문된 메뉴 참조가 깨지지 않음

#### Order — 주문 테이블

```prisma
model Order {
  id              String   @id @default(cuid())
  orderNumber     Int      @unique            // 코드에서 채번 (SQLite는 non-id autoincrement 미지원)
  status          String   @default("PENDING") // PENDING, PAYMENT_PENDING, PAID, CANCELLED, REFUNDED, FAILED
  totalAmount     Int
  idempotencyKey  String   @unique
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  items           OrderItem[]
  payment         Payment?
}
```

- `orderNumber`: 고객에게 보여줄 사람이 읽기 쉬운 번호. SQLite는 `@id`가 아닌 필드에 `autoincrement()`를 쓸 수 없으므로 코드에서 직접 채번한다
- `status`를 `String`으로 쓰는 이유: SQLite는 `enum`을 지원하지 않는다. 허용 값(PENDING, PAID 등)은 서비스 코드와 Pydantic에서 검증한다
- `idempotencyKey`: 프론트에서 생성한 키 — 같은 키로 두 번 주문이 들어오면 중복 생성을 막는다
- `payment?`: 결제는 주문 생성 이후에 발생하므로 optional

#### OrderItem — 주문 항목

```prisma
model OrderItem {
  id       String @id @default(cuid())
  quantity Int
  price    Int                  // ← 주문 시점 가격 스냅샷

  orderId  String
  order    Order  @relation(fields: [orderId], references: [id])
  menuId   String
  menu     Menu   @relation(fields: [menuId], references: [id])
}
```

- `price`에 **주문 시점 가격**을 저장하는 이유: 메뉴 가격이 나중에 바뀌어도 과거 주문 금액이 변하지 않아야 함

#### Payment — 결제 테이블

```prisma
model Payment {
  id              String    @id @default(cuid())
  paymentKey      String?   @unique              // Toss에서 발급하는 고유 키
  method          String?                         // CARD, CASH 등
  status          String    @default("READY")     // READY, IN_PROGRESS, DONE, CANCELED, PARTIAL_CANCELED, ABORTED, EXPIRED
  amount          Int
  approvedAt      DateTime?
  failReason      String?
  rawResponse     String?                         // Toss 응답 전체 JSON (디버깅용)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  orderId         String    @unique               // 1:1 관계
  order           Order     @relation(fields: [orderId], references: [id])
}
```

- `paymentKey?`: Toss 결제창을 열어야 발급되므로 처음엔 null
- `status`를 `String`으로 쓰는 이유: SQLite는 `enum`을 지원하지 않는다. Toss Payments가 사용하는 상태값(READY, DONE 등)과 동일하게 맞추되, 검증은 코드에서 한다
- `rawResponse`: Toss API 응답 원본 — 문제 발생 시 디버깅 핵심 자료
- `orderId @unique`: 주문 하나에 결제 하나 (1:1)

#### IdempotencyRecord — 멱등성 레코드

```prisma
model IdempotencyRecord {
  id             String   @id @default(cuid())
  idempotencyKey String   @unique
  httpMethod     String
  path           String
  statusCode     Int
  responseBody   String
  createdAt      DateTime @default(now())
  expiresAt      DateTime
}
```

- 동일한 `Idempotency-Key`로 재요청이 오면, 이 테이블에서 저장된 응답을 꺼내 그대로 반환
- `expiresAt`: 24시간 후 만료 — 무한히 쌓이지 않도록

#### WebhookEvent — 웹훅 이벤트 감사 로그

```prisma
model WebhookEvent {
  id          String   @id @default(cuid())
  eventType   String
  paymentKey  String
  payload     String
  processed   Boolean  @default(false)
  processedAt DateTime?
  createdAt   DateTime @default(now())
}
```

- Toss가 같은 웹훅을 **여러 번** 보낼 수 있다 — `paymentKey + eventType + processed` 조합으로 중복 처리 방지
- `payload`: 원본 JSON 보관 — 감사(audit) 및 디버깅용

### Step 2-2. DB 생성

> **전제:** Phase 1에서 만든 가상환경이 활성화된 상태여야 한다.
> `prisma`는 venv 안에 설치되어 있으므로 활성화 없이 실행하면 `command not found`가 뜬다.

```bash
cd backend
source venv/bin/activate      # venv 활성화 (이미 되어있으면 생략)
prisma generate               # Python 클라이언트 코드 생성
prisma db push                # SQLite 파일(dev.db)에 스키마 적용
```

**`prisma generate`와 `prisma db push`의 차이:**

- `generate`: Prisma 클라이언트 코드를 Python 패키지로 생성 (DB에는 아무 일도 안 함)
- `db push`: 실제 DB에 테이블을 생성/수정 (개발용, 마이그레이션 히스토리 없음)

### Step 2-3. Prisma 클라이언트 초기화

**파일:** `backend/app/db/client.py`

```python
from prisma import Prisma

db = Prisma()

def get_db() -> Prisma:
    return db
```

**왜 전역 인스턴스?**

- Prisma 클라이언트는 내부에 connection pool을 관리한다
- 요청마다 새로 만들면 커넥션이 폭증 — 모듈 레벨에서 하나만 생성

**왜 `get_db()` 함수?**

- 나중에 테스트에서 mock으로 교체하기 편함
- FastAPI의 Depends()와 조합 가능

### Step 2-4. 환경 설정 모듈

**파일:** `backend/app/config.py`

```python
import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "file:./dev.db")
    TOSS_SECRET_KEY: str = os.getenv("TOSS_SECRET_KEY", "")
    TOSS_WEBHOOK_SECRET: str = os.getenv("TOSS_WEBHOOK_SECRET", "")
    CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

settings = Settings()
```

**왜 `.env`에서 로드하나?**

- 코드에 시크릿을 하드코딩하면 git에 올라간다
- 환경(개발/운영)마다 다른 값을 주입 가능
- `python-dotenv`가 `.env` 파일을 자동으로 읽어 `os.getenv()`에 반영

### Step 2-5. Pydantic 스키마 정의

**파일:** `backend/app/models/schemas.py`

```python
from pydantic import BaseModel, Field
from datetime import datetime

# ─── 요청 스키마 ───

class OrderItemCreate(BaseModel):
    menu_id: str
    quantity: int = Field(ge=1)

class OrderCreate(BaseModel):
    items: list[OrderItemCreate]
    idempotency_key: str = Field(min_length=16, max_length=64)

class PaymentConfirmRequest(BaseModel):
    payment_key: str
    order_id: str
    amount: int

# ─── 응답 스키마 ───

class OrderResponse(BaseModel):
    id: str
    order_number: int
    status: str
    total_amount: int
    items: list[dict]
    created_at: datetime

    model_config = {"from_attributes": True}

class PaymentResponse(BaseModel):
    id: str
    payment_key: str | None
    status: str
    amount: int
    method: str | None
    approved_at: datetime | None

    model_config = {"from_attributes": True}
```

**왜 Pydantic?**

- FastAPI가 요청 body를 자동으로 검증 — `quantity: int = Field(ge=1)`이면 0 이하를 거부
- `model_config = {"from_attributes": True}` — Prisma 객체를 바로 응답으로 변환 가능
- 자동 OpenAPI 문서 생성 (Swagger UI)

### Step 2-6. FastAPI 앱 진입점

**파일:** `backend/app/main.py`

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.client import db
from app.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()

app = FastAPI(title="Toss-Sync POS API", lifespan=lifespan)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
```

**`lifespan`이 뭔가?**

- FastAPI 앱이 **시작할 때** Prisma 연결, **종료할 때** 연결 해제
- 예전 `@app.on_event("startup")`의 최신 대체

**CORS가 왜 필요한가?**

- 프론트엔드(`localhost:3000`)와 백엔드(`localhost:8000`)는 **다른 출처(origin)**
- 브라우저는 보안상 다른 출처 요청을 차단 — CORS 미들웨어가 이를 허용

### Step 2-7. 서버 실행 테스트

```bash
cd backend
source venv/bin/activate      # venv 활성화 (이미 되어있으면 생략)
uvicorn app.main:app --reload
```

---

## 검증 체크리스트

> 모든 명령어는 **venv 활성화 상태**에서 실행한다 (`source backend/venv/bin/activate`).

- [ ] **DB 파일 생성 확인**

  ```bash
  ls backend/dev.db
  # → 파일 존재
  ```

- [ ] **Prisma 클라이언트 생성 확인**

  ```bash
  cd backend && python -c "from prisma import Prisma; print('Prisma OK')"
  # → "Prisma OK" 출력
  ```

- [ ] **서버 기동 확인**

  ```bash
  # (별도 터미널에서 uvicorn 실행 후)
  curl http://localhost:8000/api/health
  # → {"status":"ok"}
  ```

- [ ] **Swagger 문서 확인**
  - 브라우저에서 `http://localhost:8000/docs` 접속
  - `/api/health` 엔드포인트가 보이면 성공

- [ ] **Prisma Studio로 DB 테이블 확인 (선택)**
  ```bash
  cd backend && prisma studio
  # → 브라우저에서 테이블 6개 확인:
  #   Menu, Order, OrderItem, Payment, IdempotencyRecord, WebhookEvent
  ```

---

## 다음 단계

→ **Phase 3**: 메뉴 API + 주문 API 구현. DB가 준비되었으니 이제 실제 데이터를 넣고 꺼내는 API를 만든다.
