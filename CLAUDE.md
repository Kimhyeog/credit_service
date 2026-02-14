# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Toss-Sync POS** — 소규모 매장을 위한 실시간 결제 처리 시스템. 결제 중 네트워크 장애, 브라우저 크래시 등에서 데이터 무결성을 보장하고 미완료 결제를 자동 복구한다.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router, React Compiler), TypeScript, Emotion, React-Query v5, React 19 |
| Backend | FastAPI (Python 3.11+), Uvicorn |
| ORM / DB | Prisma (`prisma-client-py`), SQLite (dev) / PostgreSQL (prod) |
| Payment | Toss Payments API (test keys), `@tosspayments/payment-sdk` |
| State | React-Query + LocalStorage WAL (Write-Ahead Log) |
| Test | Vitest (frontend), Pytest + pytest-asyncio (backend) |

## Build & Run Commands

```bash
# Backend (activate venv first: source backend/venv/bin/activate)
cd backend
pip install -r requirements.txt
prisma generate                   # generate Prisma Python client
prisma db push                    # apply schema to SQLite
python prisma/seed.py             # seed 8 menu items (커피, 음료, 베이커리)
uvicorn app.main:app --reload     # dev server on :8000

# Frontend
cd frontend
npm install
npm run dev                       # dev server on :3000
npm run build                     # production build

# Tests
cd backend && pytest              # all backend tests
cd backend && pytest tests/test_orders.py -k "test_name"  # single test
cd frontend && npx vitest         # all frontend tests (watch mode)
cd frontend && npx vitest run src/__tests__/path/to/test.ts  # single test
```

**Note:** Vitest is not yet in `frontend/package.json` — install with `npm install -D vitest` before running. No lint script is configured for either side.

## Implementation Status

This project is at **Phase 3** (of 14). Backend Menu/Order APIs are implemented; frontend is still create-next-app boilerplate. See `docs/report/implementation-guide.md` for the full phase roadmap and `docs/architecture-guide.md` for the target design with code samples.

**Implemented (has real code):**
- Prisma schema with all 6 models (`backend/prisma/schema.prisma`)
- Prisma client singleton (`backend/app/db/client.py`)
- FastAPI entry with CORS + Prisma lifecycle (`backend/app/main.py`)
- Config with env vars (`backend/app/config.py`)
- Pydantic v2 request/response schemas (`backend/app/models/schemas.py`)
- Menu CRUD router — GET list, POST create, PUT update, DELETE soft-delete (`backend/app/routers/menus.py`)
- Order router — POST create, GET list, GET detail, PATCH cancel (`backend/app/routers/orders.py`)
- Order service — price snapshot, manual order numbering, status validation (`backend/app/services/order_service.py`)
- Seed script with 8 menu items (`backend/prisma/seed.py`)

**Empty scaffolding:**
- `backend/app/middleware/` — idempotency and error handler not built
- `backend/app/services/` — payment_service, toss_client not built
- `backend/tests/` — no tests yet
- `frontend/src/` — all subdirectories (components, hooks, providers, services, types, utils) are empty

**Next phases to build (Phase 4+):**
- Frontend providers, components, hooks, pages
- Payment routers + Toss integration (httpx)
- Idempotency middleware, webhook handler
- WAL/recovery system, state machine
- Admin dashboard, tests

## Architecture

Monorepo: `frontend/` (Next.js) + `backend/` (FastAPI).

### Backend (`backend/`)

```
app/
├── main.py              # FastAPI app, CORS, Prisma connect/disconnect, router includes
├── config.py            # Settings class (reads .env via python-dotenv)
├── db/client.py         # db = Prisma() singleton, get_db()
├── models/schemas.py    # Pydantic v2: OrderCreate, OrderItemCreate, PaymentConfirmRequest, OrderResponse, PaymentResponse
├── routers/
│   ├── menus.py         # /api/menus — CRUD with soft delete
│   └── orders.py        # /api/orders — create/list/detail/cancel
├── services/
│   └── order_service.py # OrderService class — business logic
└── middleware/           # (empty — idempotency, error_handler planned)
prisma/
├── schema.prisma        # 6 models: Menu, Order, OrderItem, Payment, IdempotencyRecord, WebhookEvent
└── seed.py              # 8 menu items
```

**Key patterns in existing code:**
- `OrderService` receives `Prisma` via constructor, called from router with `get_db()`
- Price snapshot: `OrderItem.price` copies `Menu.price` at order time
- Manual order numbering: queries last order's `orderNumber` and increments (SQLite limitation)
- Soft delete for menus: sets `isAvailable=false` to preserve OrderItem references
- All router prefixes: `/api/` (configured in `main.py` `include_router`)

### Frontend (`frontend/src/`)

- **Path alias:** `@/*` → `./src/*` (in `tsconfig.json`)
- **React Compiler:** Enabled in `next.config.ts`
- Currently default Next.js boilerplate — no custom code yet

**Target architecture** (described in `docs/architecture-guide.md`):
- Provider hierarchy: `QueryProvider > ThemeProvider > CartProvider > Layout > Page`
- Pages: `/` (POS), `/payment`, `/payment/success`, `/payment/fail`, `/admin`
- Payment: Strategy pattern with `TossPaymentStrategy` / `MockPaymentStrategy`, switched via `NEXT_PUBLIC_PAYMENT_MOCK`
- State machine: `paymentReducer` — IDLE → WAL_WRITING → ORDER_CREATING → TOSS_POPUP → CONFIRMING → DONE
- WAL + Recovery: LocalStorage write-ahead log for crash recovery of incomplete payments

### Key Design Decisions

- **Idempotency:** Frontend generates keys (format: `pos_{hash}_{timestamp}_{random}`), backend middleware stores/replays responses for 24h via `IdempotencyRecord` model
- **Prices as Int:** 원 단위 (no floating-point errors)
- **All IDs:** `cuid()` generated by Prisma
- **Order → Payment:** 1:1 relationship
- **OrderStatus flow:** PENDING → PAYMENT_PENDING → PAID / CANCELLED / REFUNDED / FAILED
- **PaymentStatus flow:** READY → IN_PROGRESS → DONE / CANCELED / PARTIAL_CANCELED / ABORTED / EXPIRED
- **Webhook → Order mapping:** DONE→PAID, CANCELED→CANCELLED, ABORTED→FAILED

## API Endpoints

| Method | Path | Description | Implemented |
|--------|------|-------------|-------------|
| GET | `/api/health` | Health check | Yes |
| GET | `/api/menus` | Menu list (available only) | Yes |
| POST | `/api/menus` | Create menu | Yes |
| PUT | `/api/menus/{id}` | Update menu | Yes |
| DELETE | `/api/menus/{id}` | Soft-delete menu | Yes |
| POST | `/api/orders` | Create order (`Idempotency-Key` header) | Yes |
| GET | `/api/orders` | Order list (optional `?status=` filter) | Yes |
| GET | `/api/orders/{id}` | Order detail | Yes |
| PATCH | `/api/orders/{id}/cancel` | Cancel order | Yes |
| POST | `/api/payments/confirm` | Confirm payment (Toss) | No |
| GET | `/api/payments/{orderId}` | Payment status | No |
| POST | `/api/payments/{orderId}/cancel` | Cancel payment | No |
| POST | `/api/webhooks/toss` | Toss webhook receiver | No |

## Environment Variables

```bash
# backend/.env
DATABASE_URL="file:./dev.db"
TOSS_SECRET_KEY="test_sk_..."
TOSS_WEBHOOK_SECRET="whsec_..."
CORS_ORIGINS="http://localhost:3000"

# frontend/.env.local
NEXT_PUBLIC_API_URL="http://localhost:8000"
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_..."
NEXT_PUBLIC_PAYMENT_MOCK="false"    # "true" to use MockPaymentStrategy
```
