# Toss-Sync POS — 서버 구동 및 운영 가이드

## 목차

1. [사전 준비](#1-사전-준비)
2. [백엔드 구동](#2-백엔드-구동)
3. [프론트엔드 구동](#3-프론트엔드-구동)
4. [환경변수 설정](#4-환경변수-설정)
5. [테스트 실행](#5-테스트-실행)
6. [API 엔드포인트 참조](#6-api-엔드포인트-참조)
7. [트러블슈팅](#7-트러블슈팅)

---

## 1. 사전 준비

| 항목 | 버전 |
|------|------|
| Python | 3.11 이상 |
| Node.js | 18 이상 |
| npm | 9 이상 |

프로젝트 루트 구조:
```
credit_service/
├── backend/    ← FastAPI + Prisma + SQLite
└── frontend/   ← Next.js 16 + React 19 + Emotion
```

---

## 2. 백엔드 구동

### 2-1. 가상환경 활성화 및 의존성 설치

```bash
cd backend
source venv/bin/activate          # 가상환경 활성화
pip install -r requirements.txt   # 의존성 설치
```

### 2-2. 데이터베이스 설정

```bash
prisma generate    # Prisma Python 클라이언트 생성
prisma db push     # schema.prisma → SQLite(dev.db)에 반영
```

### 2-3. 시드 데이터 입력

```bash
python prisma/seed.py
```

8개 메뉴가 생성됩니다:

| 메뉴 | 가격 | 카테고리 |
|------|------|----------|
| 아메리카노 | 4,500원 | 커피 |
| 카페라떼 | 5,000원 | 커피 |
| 바닐라라떼 | 5,500원 | 커피 |
| 녹차라떼 | 5,500원 | 음료 |
| 초코라떼 | 5,500원 | 음료 |
| 딸기스무디 | 6,000원 | 음료 |
| 크로와상 | 3,500원 | 베이커리 |
| 치즈케이크 | 6,500원 | 베이커리 |

### 2-4. 서버 실행

```bash
uvicorn app.main:app --reload
```

`http://localhost:8000` 에서 실행됩니다.

헬스체크 확인:
```bash
curl http://localhost:8000/api/health
# → {"status": "ok"}
```

---

## 3. 프론트엔드 구동

### 3-1. 의존성 설치 및 실행

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:3000` 에서 실행됩니다.

### 3-2. 프로덕션 빌드

```bash
npm run build   # 빌드
npm run start   # 프로덕션 서버 실행
```

---

## 4. 환경변수 설정

### 백엔드 (`backend/.env`)

```bash
DATABASE_URL="file:./dev.db"
TOSS_SECRET_KEY="test_sk_..."         # Toss 시크릿 키 (테스트)
TOSS_WEBHOOK_SECRET="whsec_..."       # Toss 웹훅 시크릿
CORS_ORIGINS="http://localhost:3000"
```

### 프론트엔드 (`frontend/.env.local`)

```bash
NEXT_PUBLIC_API_URL="http://localhost:8000"
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_..."    # Toss 클라이언트 키 (테스트)
NEXT_PUBLIC_PAYMENT_MOCK="false"              # "true": Mock 결제 / "false": 실제 Toss
```

---

## 5. 테스트 실행

### 백엔드 테스트 (pytest)

```bash
cd backend
source venv/bin/activate

# 전체 테스트 (15개)
pytest

# 파일 단위
pytest tests/test_orders.py      # 주문 6개
pytest tests/test_payments.py    # 결제 5개
pytest tests/test_webhooks.py    # 웹훅 4개

# 개별 테스트
pytest tests/test_orders.py -k "test_create_order_success"
```

테스트는 별도 DB(`test.db`)를 사용하며 dev.db에 영향을 주지 않습니다.

### 프론트엔드 테스트 (Vitest)

```bash
cd frontend

# 전체 테스트 (31개)
npm test              # 단일 실행
npm run test:watch    # 감시 모드

# 파일 단위
npx vitest run src/__tests__/hooks/paymentReducer.test.ts    # 15개
npx vitest run src/__tests__/services/WALManager.test.ts     # 7개
npx vitest run src/__tests__/hooks/cartReducer.test.ts       # 6개
npx vitest run src/__tests__/services/idempotency.test.ts    # 3개
```

---

## 6. API 엔드포인트 참조

### 메뉴

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/menus` | 판매 가능한 메뉴 목록 |
| POST | `/api/menus` | 메뉴 생성 |
| PUT | `/api/menus/{id}` | 메뉴 수정 |
| DELETE | `/api/menus/{id}` | 메뉴 소프트 삭제 |

### 주문

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/orders` | 주문 생성 (Idempotency-Key 헤더 필요) |
| GET | `/api/orders` | 주문 목록 (쿼리: `?status=PAID`) |
| GET | `/api/orders/{id}` | 주문 상세 |
| PATCH | `/api/orders/{id}/status` | KDS 상태 전환 |
| PATCH | `/api/orders/{id}/cancel` | 주문 취소 |

### 결제

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/payments/confirm` | 결제 승인 (Toss 연동) |
| GET | `/api/payments/{orderId}` | 결제 상태 조회 |
| POST | `/api/payments/{orderId}/cancel` | 결제 취소 |

### 웹훅

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/webhooks/toss` | Toss 웹훅 수신 |

---

## 7. 트러블슈팅

### "prisma: command not found"

```bash
pip install prisma
prisma generate
```

### "CORS 에러"

`backend/.env`의 `CORS_ORIGINS`에 프론트엔드 URL이 포함되어 있는지 확인하세요.

### "Event loop is closed" (pytest)

`backend/pyproject.toml`에 다음이 있는지 확인:
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
asyncio_default_test_loop_scope = "session"
```

### 포트 충돌

백엔드(8000)와 프론트엔드(3000) 포트가 이미 사용 중인 경우:
```bash
# 포트 사용 확인
lsof -i :8000
lsof -i :3000

# 프로세스 종료
kill -9 <PID>
```

### 데이터베이스 초기화

```bash
cd backend
rm prisma/dev.db        # DB 삭제
prisma db push          # 스키마 재적용
python prisma/seed.py   # 시드 데이터 입력
```
