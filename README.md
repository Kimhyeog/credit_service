# Toss-Sync POS

소규모 매장을 위한 실시간 결제 처리 시스템.
결제 중 네트워크 장애, 브라우저 크래시 등에서 데이터 무결성을 보장하고 미완료 결제를 자동 복구합니다.

**배포 URL**
- Frontend: https://toss-sync-pos.vercel.app
- Backend API: https://credit-service-pd5u.onrender.com

---

## 아키텍처

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Vercel     │     │   Render     │     │    Neon      │
│              │     │              │     │              │
│  Frontend    │────→│  Backend     │────→│  PostgreSQL  │
│  Next.js 16  │     │  FastAPI     │     │              │
│  React 19    │     │  Prisma ORM  │     │              │
│              │     │  Docker      │     │              │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  Toss API    │
                     │  Payments    │
                     └──────────────┘
```

### 기술 스택

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Emotion, React-Query v5 |
| Backend | FastAPI, Python 3.13, Uvicorn |
| ORM / DB | Prisma (prisma-client-py), PostgreSQL (Neon) |
| Payment | Toss Payments API, `@tosspayments/payment-sdk` |
| Infra | Vercel (Frontend), Render (Backend), Neon (DB) |
| Test | Vitest (Frontend), Pytest + pytest-asyncio (Backend) |

---

## 주요 기능

### 1. 멀티 채널 주문

3가지 주문 채널을 지원하며, 각각 독립된 UI를 제공합니다.

| 채널 | URL | 설명 |
|------|-----|------|
| POS | `/` | 매장 직원용 — 메뉴 그리드 + 우측 장바구니 |
| 키오스크 | `/kiosk` | 고객 셀프 주문 — 모바일 최적화 2열 레이아웃 |
| 테이블 오더 | `/order/{tableId}` | 테이블별 주문 — QR 코드로 접근 |

### 2. 실시간 결제 (Toss Payments)

```
메뉴 선택 → 결제하기 → Toss 결제창 → 결제 완료 → 주문 확정
```

- **Strategy 패턴**: `TossPaymentStrategy` (실결제) / `MockPaymentStrategy` (테스트) 전환 가능
- **결제 상태 머신**: 10개 상태의 순수 함수 리듀서로 관리

```
IDLE → WAL_WRITING → ORDER_CREATING → TOSS_POPUP → CONFIRMING → DONE
                                         ↓
                                    ERROR → IDLE (자동 복귀)
```

### 3. 결제 안전 장치

| 장치 | 설명 |
|------|------|
| **WAL (Write-Ahead Log)** | 결제 의도를 localStorage에 기록 → 브라우저 크래시 시 자동 복구 |
| **멱등성 (Idempotency)** | `Idempotency-Key` 헤더로 동일 주문 중복 생성 방지 (24시간 TTL) |
| **결제 잠금** | 다른 탭에서 동시 결제 차단 (localStorage 기반, 5분 TTL) |
| **오프라인 감지** | 네트워크 끊김 시 배너 표시 + 결제 차단 |
| **Webhook** | Toss 웹훅으로 서버 측 결제 상태 동기화 (중복 처리 방지) |

### 4. KDS (주방 디스플레이)

`/admin/orders`에서 칸반 보드 형태로 주문 상태를 관리합니다.

```
접수 (PAID) → 준비중 (PREPARING) → 완료 (COMPLETED)
     ↓
  취소 (CANCELLED)
```

### 5. 관리자 대시보드

`/admin`에서 매출 요약, 주문 목록, 주문 상세를 확인합니다.

- 오늘 매출 합계
- 주문 건수 / 평균 단가
- 주문별 상세 내역 + 결제 정보

### 6. 다크 모드

상단 테마 토글(🌙/☀️)로 전환. localStorage에 저장되어 새로고침 후에도 유지됩니다.

---

## DB 스키마

```
┌────────┐     ┌─────────┐     ┌───────────┐
│  Menu  │◄────│OrderItem│────→│   Order   │
│        │     │ (price  │     │           │
│ name   │     │ snapshot)│     │ status    │
│ price  │     └─────────┘     │ totalAmt  │
│ category│                    │ source    │
└────────┘                    └─────┬─────┘
                                    │ 1:1
                              ┌─────▼─────┐
                              │  Payment  │
                              │ paymentKey│
                              │ status    │
                              │ amount    │
                              └───────────┘

┌───────────────────┐     ┌──────────────┐
│ IdempotencyRecord │     │ WebhookEvent │
│ key + response    │     │ eventType    │
│ 24h TTL           │     │ paymentKey   │
└───────────────────┘     └──────────────┘
```

6개 모델: `Menu`, `Order`, `OrderItem`, `Payment`, `IdempotencyRecord`, `WebhookEvent`

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스체크 |
| GET | `/api/menus` | 메뉴 목록 |
| POST | `/api/menus` | 메뉴 생성 |
| PUT | `/api/menus/{id}` | 메뉴 수정 |
| DELETE | `/api/menus/{id}` | 메뉴 삭제 (soft delete) |
| POST | `/api/orders` | 주문 생성 |
| GET | `/api/orders` | 주문 목록 (`?status=` 필터) |
| GET | `/api/orders/{id}` | 주문 상세 |
| PATCH | `/api/orders/{id}/status` | KDS 상태 전환 |
| PATCH | `/api/orders/{id}/cancel` | 주문 취소 |
| POST | `/api/payments/confirm` | 결제 승인 |
| GET | `/api/payments/{orderId}` | 결제 조회 |
| POST | `/api/payments/{orderId}/cancel` | 결제 취소 |
| POST | `/api/webhooks/toss` | Toss 웹훅 수신 |

---

## 프로젝트 구조

```
credit_service/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI 앱, CORS, 미들웨어
│   │   ├── config.py              # 환경변수 설정
│   │   ├── db/client.py           # Prisma 싱글턴
│   │   ├── models/schemas.py      # Pydantic v2 스키마
│   │   ├── routers/               # 라우터 (menus, orders, payments, webhooks)
│   │   ├── services/              # 비즈니스 로직 (order, payment, toss, webhook)
│   │   └── middleware/            # 멱등성, 에러 핸들러
│   ├── prisma/
│   │   ├── schema.prisma          # 6개 모델 정의
│   │   └── seed.py                # 시드 데이터 (9개 메뉴)
│   ├── tests/                     # pytest (15개 테스트)
│   ├── Dockerfile                 # Render 배포용
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/                   # Next.js App Router 페이지
│   │   ├── components/            # UI 컴포넌트 (pos, kiosk, order, admin, payment, common)
│   │   ├── hooks/                 # 커스텀 훅 (usePayment, useRecovery, useCart 등)
│   │   ├── providers/             # Context Providers (Cart, Theme, Query, App)
│   │   ├── services/              # API 클라이언트, 결제 서비스, WAL, Recovery
│   │   ├── types/                 # TypeScript 타입 정의
│   │   └── utils/                 # 유틸리티 (멱등성 키 생성)
│   ├── src/__tests__/             # Vitest (31개 테스트)
│   ├── next.config.ts
│   └── package.json
│
└── README.md
```

---

## 로컬 개발 환경

### 사전 요구사항

- Python 3.11+
- Node.js 18+
- npm 9+

### 백엔드

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
prisma generate
prisma db push
python prisma/seed.py
uvicorn app.main:app --reload    # http://localhost:8000
```

### 프론트엔드

```bash
cd frontend
npm install
npm run dev                      # http://localhost:3000
```

### 환경변수

**backend/.env**
```bash
DATABASE_URL="file:./dev.db"
TOSS_SECRET_KEY="test_sk_..."
TOSS_WEBHOOK_SECRET="..."
CORS_ORIGINS="http://localhost:3000"
```

**frontend/.env.local**
```bash
NEXT_PUBLIC_API_URL="http://localhost:8000"
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_..."
NEXT_PUBLIC_PAYMENT_MOCK="false"
```

---

## 테스트

```bash
# Backend (15개 테스트)
cd backend && pytest

# Frontend (31개 테스트)
cd frontend && npm test
```

---

## 결제 테스트 방법

Toss 테스트 카드 정보:

| 항목 | 값 |
|------|-----|
| 카드번호 | `4330-0000-0000-0880` |
| 유효기간 | 미래 날짜 (예: `12/30`) |
| CVC | 아무 3자리 (예: `123`) |
| 비밀번호 앞 2자리 | 아무 2자리 (예: `00`) |

### 테스트 시나리오

1. POS(`/`) → 메뉴 선택 → "결제하기" → 테스트 카드로 결제 → 성공 페이지 확인
2. `/admin/orders` → KDS에서 접수 → "준비 시작" → "완료" 순서로 처리
3. `/admin` → 매출 대시보드에 반영 확인

---

## 배포 아키텍처

```
Vercel (Frontend)  ──→  Render (Backend, Docker)  ──→  Neon (PostgreSQL)
   자동 SSL               자동 SSL                      자동 백업
   자동 CDN               Docker 빌드                   0.5GB 무료
   $0/월                  $0/월                         $0/월
```

코드를 `git push origin main`하면 Render와 Vercel 모두 **자동 재배포**됩니다.

---

## 라이선스

MIT
