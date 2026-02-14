# Toss-Sync POS 단계별 구현 가이드

> `docs/architecture-guide.md` 설계를 기반으로 한 전체 구현 로드맵.
> 각 단계는 **의존성 순서**로 정렬되어 있어 순서대로 진행하면 된다.

---

## 목차

- [Phase 1. 프로젝트 초기화 & 환경 구성](#phase-1-프로젝트-초기화--환경-구성)
- [Phase 2. 백엔드 기반 — DB + 공통 모듈](#phase-2-백엔드-기반--db--공통-모듈)
- [Phase 3. 백엔드 — 메뉴 & 주문 API](#phase-3-백엔드--메뉴--주문-api)
- [Phase 4. 프론트엔드 기반 — 렌더링 전략 & Provider & 테마 & API 클라이언트](#phase-4-프론트엔드-기반--렌더링-전략--provider--테마--api-클라이언트)
- [Phase 5. 프론트엔드 — POS 메인 화면 + 키오스크 + 테이블오더](#phase-5-프론트엔드--pos-메인-화면--키오스크--테이블오더)
- [Phase 6. 백엔드 — 결제 API & Toss 연동](#phase-6-백엔드--결제-api--toss-연동)
- [Phase 7. 프론트엔드 — 결제 추상화 & 결제 플로우 페이지](#phase-7-프론트엔드--결제-추상화--결제-플로우-페이지)
- [Phase 8. 멱등성 보장 (프론트 + 백)](#phase-8-멱등성-보장-프론트--백)
- [Phase 9. 결제 상태 머신 & WAL & 자동 복구](#phase-9-결제-상태-머신--wal--자동-복구)
- [Phase 10. 웹훅 핸들러](#phase-10-웹훅-핸들러)
- [Phase 11. 관리자 대시보드 고도화 & KDS](#phase-11-관리자-대시보드-고도화--kds)
- [Phase 12. 중복 탭 방지 & 엣지 케이스 처리](#phase-12-중복-탭-방지--엣지-케이스-처리)
- [Phase 13. 테스트](#phase-13-테스트)
- [Phase 14. 마무리 & 배포 준비](#phase-14-마무리--배포-준비)

---

## Phase 1. 프로젝트 초기화 & 환경 구성 ✅

> **목표:** 모노레포 디렉토리 뼈대 + 백엔드/프론트엔드 프로젝트 생성 + 환경변수 설정
> **상태:** 완료

### 1-1. 디렉토리 구조 생성

> **주의:** 아래는 프로젝트 **최종 목표 디렉토리 구조**다.
> Phase 1에서는 굵은 글씨(`★`)로 표시된 디렉토리만 생성하고, 나머지는 해당 Phase에서 점진적으로 추가한다.

```
credit_service/
├── backend/                         ★ Phase 1
│   ├── app/                         ★ Phase 1
│   │   ├── routers/                 ★ Phase 1
│   │   ├── services/                ★ Phase 1
│   │   ├── middleware/              ★ Phase 1
│   │   ├── models/                  ★ Phase 1
│   │   └── db/                      ★ Phase 1
│   ├── prisma/                      ★ Phase 1
│   └── tests/                       ★ Phase 1
├── frontend/                        ★ Phase 1 (create-next-app)
│   └── src/
│       ├── app/                     ★ Phase 1 (자동 생성)
│       │   ├── (pos)/               Phase 4 (Route Group)
│       │   ├── kiosk/               Phase 4
│       │   ├── order/[tableId]/     Phase 4
│       │   ├── admin/               Phase 4
│       │   │   └── orders/          Phase 4
│       │   └── payment/             Phase 4
│       │       ├── success/         Phase 4 (스텁), Phase 7 (구현 교체)
│       │       └── fail/            Phase 4 (스텁), Phase 7 (구현 교체)
│       ├── components/              ★ Phase 1
│       │   ├── common/              Phase 4-5
│       │   ├── pos/                 Phase 5
│       │   ├── kiosk/               Phase 5
│       │   ├── order/               Phase 5
│       │   ├── admin/               Phase 5, 11
│       │   └── payment/             Phase 9
│       ├── providers/               ★ Phase 1
│       ├── services/                ★ Phase 1
│       │   └── payment/             Phase 7
│       │       └── recovery/        Phase 9
│       ├── lib/                     Phase 4 (서버 컴포넌트용 API)
│       ├── hooks/                   ★ Phase 1
│       ├── styles/                  ★ Phase 1
│       ├── types/                   ★ Phase 1
│       └── utils/                   Phase 8
└── docs/                            ★ Phase 1
```

### 1-2. 백엔드 프로젝트 초기화

```bash
cd backend
```

- [x] `requirements.txt` 작성

```
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
prisma>=0.11.0
pydantic>=2.5.0
httpx>=0.25.0
python-dotenv>=1.0.0
pytest>=7.4.0
pytest-asyncio>=0.21.0
```

- [x] `app/__init__.py` 빈 파일 생성 (패키지 인식)
- [x] `app/routers/__init__.py`, `app/services/__init__.py`, `app/middleware/__init__.py`, `app/models/__init__.py`, `app/db/__init__.py` 빈 파일 생성

### 1-3. 프론트엔드 프로젝트 초기화

```bash
npx create-next-app@latest frontend --typescript --app --src-dir --use-npm
cd frontend
npm install @emotion/react @emotion/styled
npm install @tanstack/react-query
npm install @tosspayments/payment-sdk
```

**프론트엔드 디렉토리 뼈대 생성:**

`create-next-app`은 `src/app/` 만 만들어준다. 나머지 디렉토리는 직접 생성한다:

```bash
cd frontend/src
mkdir -p components providers services hooks styles types
```

> `lib/`, `utils/`, `components/` 하위 폴더(`common/`, `pos/`, `kiosk/` 등), `app/` 하위 라우트 폴더(`(pos)/`, `kiosk/` 등)는 해당 Phase에서 파일을 만들 때 함께 생성한다.
> Phase 1에서 미리 만들어도 되지만, 빈 폴더가 많아지면 혼란스러울 수 있으므로 필요할 때 만드는 것을 권장한다.

### 1-4. 환경변수 파일 생성

**`backend/.env`**
```bash
DATABASE_URL="file:./dev.db"
TOSS_SECRET_KEY="test_sk_xxxxxxxxxxxx"
TOSS_WEBHOOK_SECRET="whsec_xxxxxxxxxxxx"
CORS_ORIGINS="http://localhost:3000"
```

**`frontend/.env.local`**
```bash
NEXT_PUBLIC_API_URL="http://localhost:8000"
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_xxxxxxxxxxxx"
NEXT_PUBLIC_PAYMENT_MOCK="true"
```

> `NEXT_PUBLIC_PAYMENT_MOCK="true"` — 초기 개발 중에는 Mock 결제 사용. Toss 키 발급 후 `"false"`로 전환.

### 1-5. 백엔드 가상환경 생성 & 의존성 설치

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

> macOS에서는 `pip`이 없고 `pip3`만 있는 경우가 많다. venv 안에서는 `pip`이 그냥 동작한다.
> 터미널을 새로 열 때마다 `source venv/bin/activate`를 다시 실행해야 한다.

### 1-6. 검증

```bash
# 백엔드 의존성 확인 (venv 활성화 상태에서)
python -c "import fastapi; import prisma; import httpx; print('OK')"

# 프론트엔드 빌드 확인
cd frontend && npm run build
```

---

## Phase 2. 백엔드 기반 — DB + 공통 모듈 ✅

> **목표:** Prisma 스키마 정의 → DB 생성 → 클라이언트 초기화 → Pydantic 스키마 → FastAPI 앱 엔트리
> **상태:** 완료

### 2-1. Prisma 스키마 작성

**파일:** `backend/prisma/schema.prisma`

아키텍처 가이드 §3.1을 기반으로 하되, **SQLite 제약사항**에 맞게 수정한다:
- `Menu`, `Order`, `OrderItem`, `Payment`, `IdempotencyRecord`, `WebhookEvent` 6개 모델
- ~~`OrderStatus`, `PaymentStatus` enum~~ → **`String` + `@default("값")`으로 대체** (SQLite는 enum 미지원)
- `Order.orderNumber`의 ~~`@default(autoincrement())`~~ → **코드에서 직접 채번** (SQLite는 non-id autoincrement 미지원)
- generator: `prisma-client-py`
- datasource: SQLite (dev)

```bash
cd backend
source venv/bin/activate      # venv 활성화
prisma generate               # Python 클라이언트 생성
prisma db push                # SQLite에 스키마 적용
```

### 2-2. Prisma 클라이언트 초기화

**파일:** `backend/app/db/client.py`

- `Prisma()` 인스턴스를 모듈 레벨에서 생성
- `get_db()` 함수: connect 상태 확인 후 클라이언트 반환
- FastAPI lifespan 이벤트에서 `connect()` / `disconnect()` 호출 예정

### 2-3. 환경 설정 모듈

**파일:** `backend/app/config.py`

- `pydantic-settings`의 `BaseSettings` 또는 `python-dotenv`로 `.env` 로드
- 필드: `DATABASE_URL`, `TOSS_SECRET_KEY`, `TOSS_WEBHOOK_SECRET`, `CORS_ORIGINS`

### 2-4. Pydantic 스키마

**파일:** `backend/app/models/schemas.py`

아키텍처 가이드 §4.2 기반:
- `OrderItemCreate` — `menu_id: str`, `quantity: int (≥1)`
- `OrderCreate` — `items: list[OrderItemCreate]`, `idempotency_key: str`
- `OrderResponse` — id, order_number, status, total_amount, items, created_at
- `PaymentConfirmRequest` — payment_key, order_id, amount
- `PaymentResponse` — id, payment_key, status, amount, method, approved_at

### 2-5. FastAPI 앱 엔트리

**파일:** `backend/app/main.py`

- FastAPI 인스턴스 생성
- CORS 미들웨어 등록 (`CORS_ORIGINS` 환경변수 기반)
- lifespan으로 Prisma `connect()` / `disconnect()`
- health check 엔드포인트: `GET /api/health`
- 라우터는 이 시점에서는 아직 등록하지 않음 (Phase 3에서 추가)

### 2-6. 검증

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
# GET http://localhost:8000/api/health → {"status": "ok"}
```

---

## Phase 3. 백엔드 — 메뉴 & 주문 API ✅

> **목표:** 메뉴 CRUD + 시드 데이터 + 주문 생성/조회 API
> **상태:** 완료

### 3-1. 메뉴 라우터

**파일:** `backend/app/routers/menus.py`

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /api/menus` | 전체 메뉴 목록 (`isAvailable=true`만) |
| `POST /api/menus` | 메뉴 등록 |
| `PUT /api/menus/{id}` | 메뉴 수정 |
| `DELETE /api/menus/{id}` | 메뉴 비활성화 (soft delete: `isAvailable=false`) |

### 3-2. 시드 데이터 스크립트

**파일:** `backend/prisma/seed.py` 또는 별도 스크립트

- 5~10개 메뉴 항목 (예: 아메리카노 4500원, 카페라떼 5000원 등)
- `prisma db push` 후 스크립트 실행으로 초기 데이터 투입

```bash
cd backend && python prisma/seed.py
```

### 3-3. 주문 서비스

**파일:** `backend/app/services/order_service.py`

`OrderService` 클래스:
- `create_order(items, idempotency_key)` → 주문 + OrderItem 일괄 생성, totalAmount 계산
- `get_orders(status?)` → 필터링 + 페이지네이션
- `get_order(order_id)` → 단건 조회 (items, payment 포함)
- `cancel_order(order_id)` → status를 `"CANCELLED"`로 변경

핵심 로직:
- `totalAmount` = 각 item의 `menu.price × quantity` 합산
- `OrderItem.price`에 주문 시점 가격 스냅샷 저장 (메뉴 가격 변경 대비)
- `orderNumber`는 코드에서 직접 채번 (기존 최대값 + 1 또는 count + 1). SQLite는 non-id `autoincrement()` 미지원

### 3-4. 주문 라우터

**파일:** `backend/app/routers/orders.py`

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /api/orders` | 주문 생성 (`Idempotency-Key` 헤더 수신) |
| `GET /api/orders` | 주문 목록 (`?status=PAID` 등 필터) |
| `GET /api/orders/{id}` | 주문 상세 |
| `PATCH /api/orders/{id}/cancel` | 주문 취소 |

### 3-5. main.py에 라우터 등록

```python
app.include_router(menus.router)
app.include_router(orders.router)
```

### 3-6. 검증

```bash
# 메뉴 조회
curl http://localhost:8000/api/menus

# 주문 생성
curl -X POST http://localhost:8000/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-key-001" \
  -d '{"items": [{"menu_id": "<MENU_ID>", "quantity": 2}], "idempotency_key": "test-key-001"}'

# 주문 조회
curl http://localhost:8000/api/orders
```

---

## Phase 4. 프론트엔드 기반 — 렌더링 전략 & Provider & 테마 & API 클라이언트 ✅

> **목표:** 렌더링 전략 수립, SC/CC 경계 설정, 타입 정의, 서버/클라이언트 API 클라이언트, 테마, Provider 계층, 라우트 구조
> **상태:** 완료

### 렌더링 전략

| 페이지 | 렌더링 | 이유 |
|--------|--------|------|
| `/` (POS 메인) | **SSR + CSR** | 서버에서 메뉴 prefetch → 클라이언트에서 장바구니/결제 |
| `/kiosk` | **SSR + CSR** | 서버에서 메뉴 fetch → 고객 셀프 주문 인터랙션 |
| `/order/[tableId]` | **Dynamic SSR + CSR** | 테이블 ID 기반 동적 렌더 + 모바일 주문 |
| `/admin` | **SSR + CSR** | 서버에서 초기 주문 fetch → 실시간 폴링 |
| `/payment/success` | **CSR** | URL params 파싱 + confirm mutation |
| `/payment/fail` | **CSR** | 에러 메시지 표시 + 재시도 |

**핵심 패턴: "Server Page → Client Shell"**
- `page.tsx` (Server Component)에서 데이터 fetch → props로 Client Component에 전달
- Client Shell에서 `initialData`로 React-Query에 주입 → 즉시 렌더링, 이후 리페치

### 토스플레이스 제품 시뮬레이션

| 토스플레이스 제품 | 시뮬레이션 | 페이지 |
|---|---|---|
| **POS** | 직원용 주문/결제, 매장/포장, 카테고리 탭, 즐겨찾기 | `/` |
| **키오스크** | 고객 셀프 주문, 큰 메뉴 카드, 간소화 플로우 | `/kiosk` |
| **테이블오더** | QR 기반 모바일 주문 (테이블 번호 포함) | `/order/[tableId]` |
| **프랜차이즈 대시보드** | 주문 목록 + 상태 필터 + 매출 요약 | `/admin` |
| **KDS (주문현황)** | 실시간 주문 보드 (접수→준비중→완료) | `/admin/orders` |

### 4-0. 렌더링 전략 & SC/CC 가이드라인

SSG/ISR/SSR/CSR 개념과 이 프로젝트에서의 적용 정리. Server Component vs Client Component 경계 설정 원칙.

### 4-1. 공통 타입 정의

**`src/types/menu.ts`** — `MenuItem { id, name, price, category, imageUrl?, isAvailable }`
**`src/types/order.ts`** — `OrderMode ("DINE_IN" | "TAKE_OUT")`, `OrderResponse`, `OrderItemCreate`, `OrderCreateRequest` 등
**`src/types/kiosk.ts`** — `KioskStep`, `TableInfo` (키오스크/테이블오더 관련)
**`src/types/api.ts`** — API 에러 타입 등

### 4-2. API 클라이언트 (클라이언트용 + 서버용)

**`src/services/api.ts`** — 클라이언트용 (`ApiClient` 클래스 + 인터셉터 체인 패턴, React-Query에서 사용)
- `errorInterceptor` — 에러 정규화 (응답 인터셉터)
- `loggingInterceptor` — 개발 환경 API 호출 로깅 (요청/응답 인터셉터)
- Phase 8에서 `idempotencyInterceptor` 추가 예정
**`src/lib/server-api.ts`** — 서버용 (Next.js 확장 fetch, ISR/캐싱)
- `getMenus()` — 60초 ISR
- `getOrders(status?)` — SSR (매 요청마다)
- `getOrder(orderId)` — SSR

### 4-3. 테마 정의

**`src/styles/theme.ts`** — `lightTheme`, `darkTheme` + 카테고리 컬러 (coffee, beverage, bakery)
**`src/styles/styled.d.ts`** — Emotion `Theme` 인터페이스 확장
**`src/styles/global.ts`** — Global 리셋 + POS/키오스크용 스크롤바 스타일

### 4-4. Provider 계층

1. **`src/providers/QueryProvider.tsx`** — React-Query 클라이언트 설정
2. **`src/providers/ThemeProvider.tsx`** — Emotion 테마 + light/dark 토글 + `useThemeMode()` 훅
3. **`src/providers/CartProvider.tsx`** — 장바구니 상태 (useReducer) + `orderMode` (매장/포장)
   - actions: `ADD_ITEM`, `REMOVE_ITEM`, `UPDATE_QUANTITY`, `SET_ORDER_MODE`, `CLEAR`
4. **`src/providers/AppProviders.tsx`** — 위 3개를 합성

### 4-5. 라우트 구조 & 레이아웃

```
src/app/
├── layout.tsx           → 루트 레이아웃 (서버) — AppProviders
├── loading.tsx          → 전역 로딩 UI
├── error.tsx            → 전역 에러 UI (클라이언트)
├── not-found.tsx        → 404 UI
├── (pos)/page.tsx       → POS 메인 (서버 → POSClientShell)
├── kiosk/page.tsx       → 키오스크 (서버 → KioskShell)
├── order/[tableId]/page.tsx → 테이블오더 (서버 → TableOrderShell)
├── admin/page.tsx       → 관리자 대시보드 (서버 → AdminShell)
├── admin/orders/page.tsx → KDS 주문현황
└── payment/success|fail/ → 결제 결과 (클라이언트)
```

### 4-6. 각 페이지별 렌더링 전략 구체화 (코드 패턴)

### 4-7. 검증

```bash
cd frontend && npm run build    # 빌드 에러 없음
cd frontend && npx tsc --noEmit # 타입 에러 없음
cd frontend && npm run dev      # localhost:3000 접속 시 에러 없이 렌더링
```

---

## Phase 5. 프론트엔드 — POS 메인 화면 + 키오스크 + 테이블오더 ✅

> **목표:** 토스 POS 스타일 메인 화면 + 키오스크 + 테이블오더, Server Page → Client Shell 패턴
> **상태:** 완료

### Server/Client Component 구조

```
Server Components (page.tsx):     Client Components (Shell):
├── (pos)/page.tsx → getMenus()   → POSClientShell
├── kiosk/page.tsx → getMenus()   → KioskShell
└── order/[tableId]/page.tsx      → TableOrderShell
```

> **참고:** `/admin` 및 `/admin/orders` 페이지는 Phase 4에서 스텁으로 생성되었으며, Phase 11에서 AdminShell/KDSBoard로 고도화 예정.

### 5-1. React-Query 훅

**`src/hooks/useMenus.ts`** — `useMenus(initialData?)` — initialData로 SSR 데이터 주입
**`src/hooks/useOrders.ts`** — `useOrders(status?)` — 3초 폴링, `useOrder(orderId)`
**`src/hooks/useCreateOrder.ts`** — `useMutation` + 낙관적 업데이트

### 5-2. 공통 UI 컴포넌트 (토스 디자인 시스템)

**`src/components/common/Button.tsx`** — 공용 버튼 (primary, danger, ghost)
**`src/components/common/ThemeToggle.tsx`** — 테마 전환 토글
**`src/components/common/CategoryTabs.tsx`** — 토스 POS 스타일 카테고리 탭 (즐겨찾기 포함)
**`src/components/common/OrderModeToggle.tsx`** — 매장/포장 토글

### 5-3. 메뉴 컴포넌트 (토스 POS 스타일)

**`src/components/pos/MenuItem.tsx`** — 카테고리 색상 코딩 + 큰 터치 영역
**`src/components/pos/MenuGrid.tsx`** — CategoryTabs 연동, props로 메뉴 수신

### 5-4. 장바구니 컴포넌트

**`src/components/pos/CartItem.tsx`** — 수량 조절, 삭제
**`src/components/pos/Cart.tsx`** — OrderModeToggle 포함, 매장/포장 선택

### 5-5. POS 메인 페이지 — Server Page → Client Shell

**`src/components/pos/POSClientShell.tsx`** — POS 전체 화면 (Client Component)
**`src/app/(pos)/page.tsx`** — 서버에서 getMenus() → POSClientShell에 전달

레이아웃:
```
┌─────────────────────────────────────────────────────────┐
│  [Toss-Sync POS]        [키오스크 전환] [KDS] [🌙]     │
├─────────────────────────────────────────────────────────┤
│  [★ 즐겨찾기] [커피] [음료] [베이커리]                   │
├──────────────────────────────┬──────────────────────────┤
│  메뉴 그리드 (카테고리 필터)  │  장바구니                 │
│                              │  [매장] [포장]            │
│                              │  총 N개    N,NNN원        │
│                              │  [     결제하기     ]     │
└──────────────────────────────┴──────────────────────────┘
```

### 5-6. 키오스크 페이지

**`src/components/kiosk/KioskShell.tsx`** — 고객용 큰 카드 UI (max-width: 768px)
**`src/app/kiosk/page.tsx`** — 서버에서 getMenus() → KioskShell에 전달

### 5-7. 테이블오더 페이지

**`src/components/order/TableOrderShell.tsx`** — 모바일 리스트 UI (max-width: 480px)
**`src/app/order/[tableId]/page.tsx`** — 동적 SSR, tableId + menus 전달

### 5-8. 검증

```bash
cd frontend && npm run build    # ✅ 빌드 성공 (타입 에러 0)

# 빌드 결과:
# ○ /                  → ISR (1분 revalidate) — POS 메인
# ○ /kiosk             → ISR (1분 revalidate) — 키오스크
# ƒ /order/[tableId]   → Dynamic SSR — 테이블오더

# 백엔드 실행 상태에서:
# 1. localhost:3000 → POS 메인 (카테고리 탭 + 메뉴 그리드 + 장바구니 + 매장/포장)
# 2. localhost:3000/kiosk → 키오스크 (고객용 큰 메뉴 카드)
# 3. localhost:3000/order/1 → 테이블오더 (모바일 리스트)
# 4. 테마 전환 동작 확인
# 5. 백엔드 미실행 시 "등록된 메뉴가 없습니다" 표시 (크래시 없음)
```

---

## Phase 6. 백엔드 — 결제 API & Toss 연동

> **목표:** Toss Payments confirm API 호출 + 결제 상태 조회/취소 API

### 6-1. Toss HTTP 클라이언트

**파일:** `backend/app/services/toss_client.py`

- `httpx.AsyncClient` 기반
- Base URL: `https://api.tosspayments.com`
- 인증: Basic auth (secret key base64 인코딩)
- 메서드:
  - `confirm_payment(payment_key, order_id, amount)` → `POST /v1/payments/confirm`
  - `cancel_payment(payment_key, reason)` → `POST /v1/payments/{paymentKey}/cancel`
  - `get_payment(payment_key)` → `GET /v1/payments/{paymentKey}`

### 6-2. 결제 서비스

**파일:** `backend/app/services/payment_service.py`

`PaymentService` 클래스:
- `confirm(payment_key, order_id, amount)`:
  1. Order 조회 → amount 일치 검증
  2. Payment 레코드 생성/업데이트 (status=IN_PROGRESS)
  3. `toss_client.confirm_payment()` 호출
  4. 성공 → Payment status=DONE, Order status=PAID
  5. 실패 → Payment status=ABORTED, failReason 기록
- `get_payment_by_order(order_id)` — 결제 상태 조회
- `cancel(payment_key, reason)` — Toss 취소 API + 상태 업데이트

### 6-3. 결제 라우터

**파일:** `backend/app/routers/payments.py`

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /api/payments/confirm` | 결제 승인 요청 (Toss confirm) |
| `GET /api/payments/{orderId}` | 결제 상태 조회 |
| `POST /api/payments/{orderId}/cancel` | 결제 취소 |

### 6-4. main.py에 라우터 등록

```python
app.include_router(payments.router)
```

### 6-5. 검증

```bash
# 결제 상태 조회 (주문 생성 후)
curl http://localhost:8000/api/payments/<ORDER_ID>
```

> Toss confirm 테스트는 프론트엔드 결제 플로우 구현 후 E2E로 검증 (Phase 7).

---

## Phase 7. 프론트엔드 — 결제 추상화 & 결제 플로우 페이지

> **목표:** Strategy 패턴으로 결제 추상화 → Mock/Toss 전환 → POS/키오스크/테이블오더 공통 결제 페이지 구현

### 다중 제품 결제 플로우

Phase 5에서 구현한 POS, 키오스크, 테이블오더 모두 동일한 결제 플로우를 공유한다.
각 제품에서 "결제하기" 버튼을 누르면 **공통 결제 파이프라인**으로 진입한다.

```
POS (/)           ──→ POST /api/orders (orderMode: DINE_IN/TAKE_OUT) ──┐
키오스크 (/kiosk)  ──→ POST /api/orders (orderMode: DINE_IN/TAKE_OUT) ──├──→ 결제 요청 ──→ /payment/success or /payment/fail
테이블오더 (/order/1)──→ POST /api/orders (orderMode: DINE_IN, tableId) ──┘
```

**제품별 차이점:**

| 항목 | POS | 키오스크 | 테이블오더 |
|------|-----|---------|-----------|
| 결제 수단 | 카드/현금 모두 | 카드만 | 카드만 |
| 결제 후 리다이렉트 | POS 메인 (`/`) | 키오스크 완료 (`/kiosk?done=1`) | 테이블오더 완료 (`/order/[tableId]?done=1`) |
| 주문 생성 시 추가 정보 | `orderMode` | `orderMode`, `source: "KIOSK"` | `orderMode: "DINE_IN"`, `tableId` |

### 7-1. 결제 서비스 인터페이스

**파일:** `src/services/payment/PaymentService.ts`

```typescript
interface PaymentRequest {
  orderId: string;
  orderName: string;  // "아메리카노 외 2건"
  amount: number;
  successUrl: string; // 제품별 다른 리다이렉트 URL
  failUrl: string;
}

interface PaymentService {
  requestPayment(request: PaymentRequest) → Toss 결제창 실행 or Mock 리다이렉트
  confirmPayment(confirm)   → POST /api/payments/confirm
  cancelPayment(key, reason)→ POST /api/payments/{key}/cancel
  getStatus(orderId)        → GET /api/payments/{orderId}
}
```

### 7-2. Toss 구현체

**파일:** `src/services/payment/TossPaymentStrategy.ts`

- `@tosspayments/payment-sdk`의 `loadTossPayments()` 사용
- `requestPayment()` → Toss 결제창 호출 (제품별 `successUrl`, `failUrl` 설정)
- `confirmPayment()` → 백엔드 `/api/payments/confirm` 호출

### 7-3. Mock 구현체

**파일:** `src/services/payment/MockPaymentStrategy.ts`

- `requestPayment()` → 즉시 `successUrl`로 리다이렉트 (mock paymentKey 생성)
- `confirmPayment()` → 항상 성공 반환 (`shouldFail` 옵션으로 실패 시뮬레이션 가능)

### 7-4. 팩토리

**파일:** `src/services/payment/index.ts`

```typescript
export function createPaymentService(): PaymentService {
  if (NEXT_PUBLIC_PAYMENT_MOCK === "true") return new MockPaymentStrategy();
  return new TossPaymentStrategy();
}
```

### 7-5. 결제 페이지 (공통)

**`src/app/payment/success/page.tsx`** — 성공 콜백 (CSR)
- URL params에서 `paymentKey`, `orderId`, `amount` 추출
- `paymentService.confirmPayment()` 호출
- 성공 → 완료 화면 표시 후 **원래 제품 페이지로 리다이렉트** (URL param `returnTo` 기반)
- 실패 → 에러 처리

**`src/app/payment/fail/page.tsx`** — 실패 콜백 (CSR)
- URL params에서 `code`, `message` 추출
- 에러 메시지 표시 + "다시 시도" 또는 "돌아가기" (`returnTo` 기반)

### 7-6. 각 제품에서 결제 플로우 연결

**POS** (`POSClientShell` 내 `PaymentButton`):
1. `POST /api/orders` → 주문 생성 (멱등성 키 포함)
2. `paymentService.requestPayment({ successUrl: "/payment/success?returnTo=/", ... })`

**키오스크** (`KioskShell` 내 "주문하기" 버튼):
1. `POST /api/orders` → 주문 생성 (`source: "KIOSK"`)
2. `paymentService.requestPayment({ successUrl: "/payment/success?returnTo=/kiosk", ... })`

**테이블오더** (`TableOrderShell` 내 "주문하기" 버튼):
1. `POST /api/orders` → 주문 생성 (`tableId` 포함)
2. `paymentService.requestPayment({ successUrl: "/payment/success?returnTo=/order/[tableId]", ... })`

### 7-7. 검증

```bash
# Mock 모드에서 각 제품별 결제 플로우:
# 1. POS: 메뉴 선택 → 장바구니 → 매장/포장 선택 → 결제하기 → /payment/success → POS로 복귀
# 2. 키오스크: 메뉴 선택 → 주문하기 → /payment/success → 키오스크 완료 화면
# 3. 테이블오더: 메뉴 선택 → 주문하기 → /payment/success → 테이블오더 완료 화면
# 4. 결제 실패 시 /payment/fail → 각 제품으로 돌아가기
```

---

## Phase 8. 멱등성 보장 (프론트 + 백)

> **목표:** 동일 요청의 중복 처리 방지 — 프론트에서 키 생성, 백엔드에서 응답 캐싱

### 8-1. 프론트엔드 — 멱등성 키 생성

**파일:** `src/utils/idempotency.ts`

- `generateIdempotencyKey(items)` → 포맷: `pos_{hash}_{timestamp}_{random}`
- djb2 해시로 장바구니 내용 핑거프린팅
- timestamp(초 단위) + UUID 8자리로 유니크성 보장

**파일:** `src/hooks/useIdempotencyKey.ts`

- `useRef`로 결제 플로우 동안 동일 키 유지
- `reset()` → 새 주문 시 키 초기화

### 8-2. 백엔드 — 멱등성 미들웨어

**파일:** `backend/app/middleware/idempotency.py`

`IdempotencyMiddleware(BaseHTTPMiddleware)`:

1. POST/PATCH 요청 + `Idempotency-Key` 헤더가 있는 경우만 처리
2. `IdempotencyRecord` 테이블에서 키 조회
3. **존재 & 미만료** → 저장된 응답 그대로 반환 (핸들러 실행 안 함)
4. **존재 & 만료** → 레코드 삭제 후 핸들러 실행
5. **미존재** → 핸들러 실행 → 응답을 `IdempotencyRecord`에 저장 (TTL 24시간)

### 8-3. main.py에 미들웨어 등록

```python
from app.middleware.idempotency import IdempotencyMiddleware
app.add_middleware(IdempotencyMiddleware)
```

> **주의:** 미들웨어 등록 순서 — `IdempotencyMiddleware`는 CORS 다음에 등록해야 한다.

### 8-4. 프론트엔드 훅에 멱등성 키 적용

`useCreateOrder`의 mutation 호출 시:
- body에 `idempotency_key` 포함
- 헤더에 `Idempotency-Key` 포함

### 8-5. 검증

```bash
# 동일 Idempotency-Key로 2번 POST → 두 번째는 저장된 응답 반환
curl -X POST http://localhost:8000/api/orders \
  -H "Idempotency-Key: test-idem-001" \
  -H "Content-Type: application/json" \
  -d '{"items": [...], "idempotency_key": "test-idem-001"}'

# 두 번째 요청: 동일 결과, 새 주문 생성 안 됨
```

---

## Phase 9. 결제 상태 머신 & WAL & 자동 복구

> **목표:** 브라우저 크래시/네트워크 장애 대응 — WAL 기록 → 상태 머신 → 자동 복구

### 9-1. 결제 상태 머신

**파일:** `src/types/payment.ts`

상태 전이 (`paymentReducer`):

```
IDLE → WAL_WRITING → ORDER_CREATING → TOSS_POPUP → CONFIRMING → DONE
                                                              ↘ CANCELLED
어느 단계든 에러 → ERROR → RETRYING (자동 3회) → NEEDS_RECOVERY
DONE / CANCELLED / NEEDS_RECOVERY → RESET → IDLE
```

- `PaymentState` 타입 (10개 상태)
- `PaymentEvent` 타입 (10개 이벤트)
- `paymentReducer(state, event) → state` 순수 함수

### 9-2. WAL Manager

**파일:** `src/services/recovery/WALManager.ts`

LocalStorage key: `toss_sync_pos_wal`

```
WALEntry {
  id, orderId?, paymentKey?, amount, items,
  idempotencyKey, state, createdAt, updatedAt
}
```

메서드:
- `write(entry)` → 새 인텐트 기록, UUID 반환
- `update(id, patch)` → orderId, paymentKey, state 등 부분 업데이트
- `remove(id)` → 완료된 엔트리 삭제
- `readAll()` → 전체 조회
- `getPending()` → 미완료 엔트리만 (`DONE`, `CANCELLED`, `IDLE` 제외)
- `cleanup(maxAgeMs)` → 24시간 이상 된 엔트리 제거

### 9-3. Recovery Service

**파일:** `src/services/recovery/RecoveryService.ts`

`recoverAll()` → 미완료 WAL 엔트리를 순회하며 복구 시도:

| WAL 상태 | orderId | paymentKey | 복구 액션 |
|----------|---------|------------|----------|
| 어떤 상태든 | null | - | WAL 제거 (주문 미생성) |
| - | 있음 | - | 서버 결제 상태 조회 |
| - | 있음 | 있음 | `POST /confirm` 재시도 |
| 위 모두 실패 | - | - | `NEEDS_RECOVERY` 마킹 |

### 9-4. usePayment 훅 (상태 머신 통합)

**파일:** `src/hooks/usePayment.ts`

- `useReducer(paymentReducer, "IDLE")`
- 결제 플로우 전체 오케스트레이션:
  1. `START_PAYMENT` → WAL 기록
  2. `WAL_WRITTEN` → 주문 생성
  3. `ORDER_CREATED` → Toss 결제창
  4. `TOSS_SUCCESS` → confirm 호출
  5. `CONFIRM_SUCCESS` → WAL 삭제, 완료
- 각 단계에서 에러 → `ERROR` → 자동 재시도 (최대 3회) → `NEEDS_RECOVERY`

### 9-5. useRecovery 훅

**파일:** `src/hooks/useRecovery.ts`

- 앱 로드 시(`useEffect`) `RecoveryService.recoverAll()` 실행
- 복구 결과를 상태로 보관 → `RecoveryBanner`에 전달

### 9-6. RecoveryBanner 컴포넌트

**파일:** `src/components/payment/RecoveryBanner.tsx`

- 미완료 결제가 있으면 POS 화면 상단에 배너 표시
- "복구된 결제 N건" 또는 "수동 확인 필요 N건" 메시지
- 닫기 / 상세보기 액션

### 9-7. 결제 플로우에 WAL 통합

`PaymentButton` 클릭 시 (Phase 7 코드 수정):
1. WAL에 인텐트 기록 (`WAL_WRITING`)
2. 주문 생성 (`ORDER_CREATING`)
3. WAL에 orderId 업데이트
4. Toss 결제창 (`TOSS_POPUP`)
5. 성공 콜백에서 WAL에 paymentKey 업데이트
6. confirm (`CONFIRMING`)
7. 성공 → WAL 삭제

### 9-8. 검증

- Mock 모드에서 POS/키오스크/테이블오더 각각 결제 플로우 → WAL 기록/삭제 확인 (DevTools → Application → LocalStorage)
- 결제 중 새로고침 → 재로드 시 RecoveryBanner 표시 확인 (POS에서만 배너 표시, 키오스크/테이블오더는 별도 복구 UI)
- 복구 자동 실행 → 서버 상태 기반 결과 확인
- WAL에 `source` 필드 포함하여 어느 제품에서 시작된 결제인지 추적 가능

---

## Phase 10. 웹훅 핸들러

> **목표:** Toss → 서버 비동기 알림 수신 + 시크릿 검증 + 중복 방지 + Toss API 재확인
>
> **선행 조건:** Phase 6 완료 (Payment API + Toss 연동), Phase 8 완료 (멱등성 미들웨어)

### 10-1. 웹훅 서비스

**파일:** `backend/app/services/webhook_service.py` (신규)

기존 패턴(OrderService, PaymentService)과 동일하게 서비스 클래스로 분리.

처리 흐름:
1. **시크릿 검증** — 요청 body의 `secret` 필드 vs `settings.TOSS_WEBHOOK_SECRET` 비교 (Toss 공식 검증 방식)
2. **중복 확인** — `WebhookEvent` 테이블에서 동일 `paymentKey + eventType` 이미 처리됐는지 조회
3. **이벤트 기록** — `WebhookEvent` 레코드 생성 (processed=false)
4. **Toss API 재확인** — `toss_client.get_payment(paymentKey)`로 실제 결제 상태를 한 번 더 검증 (웹훅 위조 방지)
5. **이벤트 처리** — `PAYMENT_STATUS_CHANGED` 시 Payment/Order 상태 업데이트
   - 상태 매핑: `DONE→PAID`, `CANCELED→CANCELLED`, `ABORTED→FAILED`, `PARTIAL_CANCELED→CANCELLED`, `EXPIRED→FAILED`
6. **완료 마킹** — `processed=true`, `processedAt` 기록

### 10-2. 웹훅 라우터

**파일:** `backend/app/routers/webhooks.py` (신규)

- `POST /api/webhooks/toss` — raw body를 `Request` 객체에서 직접 파싱하여 `WebhookService`에 전달
- Toss 웹훅 body 구조: `{ "eventType": "...", "createdAt": "...", "secret": "...", "data": { "paymentKey": "...", "orderId": "...", "status": "..." } }`
- 응답: 항상 200 OK 반환 (Toss는 비-200 시 재시도함)

### 10-3. main.py에 라우터 등록

```python
from app.routers import menus, orders, payments, webhooks
app.include_router(webhooks.router)
```

### 10-4. 검증

```bash
# 웹훅 수동 테스트
curl -X POST http://localhost:8000/api/webhooks/toss \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "PAYMENT_STATUS_CHANGED",
    "createdAt": "2026-02-15T12:00:00+09:00",
    "secret": "<TOSS_WEBHOOK_SECRET>",
    "data": {
      "paymentKey": "pk_test_xxx",
      "orderId": "order_id_xxx",
      "status": "DONE"
    }
  }'
```

> 실제 Toss 웹훅은 Toss 대시보드에서 webhook URL 등록 후 테스트 가능.

---

## Phase 11. 관리자 대시보드 고도화 & KDS

> **목표:** Phase 4에서 스텁으로 생성한 관리자 페이지(`/admin`, `/admin/orders`)를 고도화 — 매출 요약, 주문 목록(필터/상세/취소), KDS 칸반 보드, 주문 출처 뱃지
>
> **선행 조건:** Phase 6 완료 (Payment API), Phase 10 완료 (웹훅)
>
> **전제:**
> - `/admin` (스텁 페이지)과 `/admin/orders` (스텁 페이지)이 이미 생성됨
> - `useOrders()` 훅 (3초 폴링)과 `useOrder()` 훅이 이미 구현됨
> - 현재 Order 모델에 `source`, `orderMode`, `tableId` 필드가 **없음** → 이 단계에서 추가

### 현재 상태 vs Phase 11에서 추가할 것

| 항목 | 현재 | Phase 11 |
|------|------|----------|
| 주문 목록 | 텍스트 스텁 | 상태 필터 탭 + 주문 행 클릭으로 상세 |
| 주문 상세 | 없음 | OrderDetail 모달 (항목, 결제 정보, 취소 버튼) |
| 매출 요약 | 없음 | 오늘 매출, 주문 건수, 평균 단가 카드 (클라이언트 계산) |
| KDS 보드 | 텍스트 스텁 | 칸반 4컬럼 (접수→준비중→완료/취소), 버튼으로 상태 전환 |
| 주문 출처 | 없음 | POS/키오스크/테이블오더 뱃지 (Order.source 기반) |
| Order 상태 | PENDING~FAILED (6개) | + PREPARING, COMPLETED (KDS용 2개 추가) |
| 백엔드 API | 주문 CRUD만 | + PATCH `/api/orders/{id}/status` (KDS 상태 전환) |

### 11-1. 백엔드 변경 (필수)

**Prisma 스키마 변경:**
- `Order` 모델에 3개 필드 추가: `source` (기본 "POS"), `orderMode` (기본 "DINE_IN"), `tableId` (nullable)
- Order status에 `PREPARING`, `COMPLETED` 추가 (KDS 흐름: PAID → PREPARING → COMPLETED)

**Pydantic 스키마 변경:**
- `OrderCreate`에 `source`, `order_mode`, `table_id` 필드 추가
- `OrderResponse`에 `source`, `order_mode`, `table_id` 필드 추가
- `OrderStatusUpdate` 스키마 신규 (status 변경용)

**신규 API:**
- `PATCH /api/orders/{id}/status` — KDS에서 상태 전환 (PAID→PREPARING→COMPLETED)

**서비스 변경:**
- `OrderService.create_order()` — source, orderMode, tableId 저장
- `OrderService.update_status()` — KDS 상태 전환 로직 (유효한 전이만 허용)

### 11-2. 프론트엔드 — 관리자 대시보드

**`src/app/admin/page.tsx`** — Server → Client Shell 패턴

레이아웃:
```
┌──────────────────────────────────────────────────────────┐
│  [Toss-Sync] 주문 관리          [KDS 보드] [POS] [🌙]   │
├──────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ 오늘 매출 │ │ 주문 건수 │ │ 평균 단가 │  ← SalesSummary│
│  │ 127,000원│ │  23건     │ │ 5,521원  │                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
├──────────────────────────────────────────────────────────┤
│  [전체] [진행중] [완료] [취소]         상태 필터 탭       │
├──────────────────────────────────────────────────────────┤
│  #023  아메리카노 x2  9,000원  PAID  [POS]  10:30       │
│  #022  카페라떼 x1    5,000원  PAID  [키오스크] 10:25    │
│  #021  바닐라라떼 x1  5,500원  PENDING [테이블3] 10:20   │
├──────────────────────────────────────────────────────────┤
│  OrderDetail (선택된 주문 모달)                           │
│  └─ 주문 항목, 결제 정보, [취소] 버튼                    │
└──────────────────────────────────────────────────────────┘
```

### 11-3. 프론트엔드 — KDS (주문현황) 보드

**`src/app/admin/orders/page.tsx`** — KDS 칸반 보드

```
┌──────────────────────────────────────────────────────────┐
│  [Toss-Sync] 주문현황 (KDS)           [대시보드] [🌙]   │
├──────────────┬──────────────┬──────────────┬─────────────┤
│  접수 (PAID)  │  준비중       │  완료         │  취소       │
│  (3건)        │  (2건)       │  (15건)       │  (1건)     │
├──────────────┼──────────────┼──────────────┼─────────────┤
│ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │             │
│ │ #023     │ │ │ #021     │ │ │ #019     │ │             │
│ │ 아메 x2  │ │ │ 바닐라 x1│ │ │ 카페 x2  │ │             │
│ │ [POS]    │ │ │ [테이블3]│ │ │ [키오스크]│ │             │
│ │ 10:30    │ │ │ 10:20    │ │ │ 10:10    │ │             │
│ │[준비시작]│ │ │[완료]    │ │ │          │ │             │
│ └──────────┘ │ └──────────┘ │ └──────────┘ │             │
└──────────────┴──────────────┴──────────────┴─────────────┘
```

### 11-4. 프론트엔드 컴포넌트

**`src/components/admin/SalesSummary.tsx`**
- 오늘 매출 합계, 주문 건수, 평균 단가
- `useOrders()` 데이터에서 PAID/PREPARING/COMPLETED 주문만 필터하여 클라이언트 계산

**`src/components/admin/OrderList.tsx`**
- 상태 필터 탭 (전체 / 진행중 / 완료 / 취소)
- 주문 행 클릭 → 선택된 orderId를 부모에 전달
- 출처 뱃지 + 시간 표시

**`src/components/admin/OrderDetail.tsx`**
- 주문 항목 목록 + 가격
- 결제 상태 (paymentKey, method, approvedAt)
- 취소 버튼 (PAID 상태일 때만) + window.confirm 다이얼로그

**`src/components/admin/KDSBoard.tsx`**
- 칸반 스타일 4컬럼 (접수/준비중/완료/취소)
- 주문 카드에 상태 전환 버튼 ("준비 시작", "완료")
- 3초 폴링으로 실시간 업데이트 (useOrders 기반)

**`src/components/admin/OrderSourceBadge.tsx`**
- `source` 필드 기반: POS (파란색), KIOSK (보라색), TABLE (초록색)

### 11-5. 프론트엔드 Shell 수정

- Cart.tsx, KioskShell.tsx, TableOrderShell.tsx에서 `createOrder.mutateAsync()` 호출 시 `source` 필드 추가
- TableOrderShell은 `table_id` 도 함께 전송

### 11-6. 프론트엔드 훅/타입 수정

- `OrderCreateRequest`에 `source`, `table_id` 추가
- `OrderResponse`에 `source`, `orderMode`, `tableId` 추가
- `useUpdateOrderStatus()` 훅 신규 — `PATCH /api/orders/{id}/status`
- `useCancelOrder()` 훅 신규 — 기존 `PATCH /api/orders/{id}/cancel` 연결

### 11-7. 검증

- `/admin` 접속 → 매출 요약 카드 + 주문 목록 (출처 뱃지 포함)
- 상태 필터 탭 전환 → 해당 주문만 표시
- 주문 클릭 → 상세 모달 (항목, 결제 정보)
- PAID 주문 취소 → confirm 다이얼로그 → 취소 성공
- `/admin/orders` (KDS) → 칸반 보드, "준비 시작" / "완료" 버튼 동작
- 3초 폴링으로 새 주문이 KDS에 실시간 반영
- POS/키오스크/테이블오더에서 주문 시 올바른 `source` 저장 확인

---

## Phase 12. 중복 탭 방지 & 엣지 케이스 처리

> **목표:** 동시 결제 방지, 결제 성공 페이지 안정성, 글로벌 에러 처리, 네트워크 오프라인 대응

### 12-1. usePaymentLock — 중복 탭 방지

**파일:** `src/hooks/usePaymentLock.ts`

LocalStorage key: `toss_sync_pos_payment_lock`

- `acquireLock()` → 기존 잠금이 5분 이내면 `false` 반환, 아니면 `{ lockedAt }` 저장 + `true` 반환
- `releaseLock()` → 잠금 해제
- `isLocked()` → 잠금 상태 확인 (5분 TTL 초과 시 만료 처리)
- **usePayment 통합:** `startPayment()` 시작 시 `acquireLock()` 호출 → 실패면 throw "다른 탭에서 결제 진행 중"
- **해제 시점:** 결제 성공 페이지에서 confirm 완료/실패 후, fail 페이지 진입 시, `beforeunload` 이벤트

### 12-2. 글로벌 에러 핸들러 미들웨어 (백엔드)

**파일:** `backend/app/middleware/error_handler.py`

FastAPI `@app.exception_handler` 또는 `BaseHTTPMiddleware`로 구현:

- `prisma.errors.PrismaError` → 500 "데이터베이스 오류"
- `prisma.errors.RecordNotFoundError` → 404
- `prisma.errors.UniqueViolationError` → 409 "중복된 레코드"
- `httpx.HTTPStatusError` (Toss API 오류) → 502 "결제 서비스 오류" + Toss 에러 코드/메시지 전달
- `Exception` (미처리) → 500 + 로그 (`logger.exception`)
- 모든 에러 응답 형식: `{ "detail": "..." }` (기존 ApiError 형식 유지)

**main.py에 등록:**
```python
from app.middleware.error_handler import register_error_handlers
register_error_handlers(app)
```

### 12-3. 결제 성공 페이지 안정성 강화

**파일:** `src/app/payment/success/page.tsx`

현재 문제점:
1. `useEffect` 의존성이 `[searchParams]`로, React Strict Mode 등에서 **두 번 실행** 가능 → confirm API 중복 호출
2. Confirm 후 WAL 정리 안 됨 → 다음 방문 시 복구 배너 표시
3. 결제 성공 후 lock 해제 안 됨

수정 사항:
- `useRef(false)` 플래그로 **재진입 방지** (한 번만 confirm 호출)
- Confirm 성공 시 `WALManager.cleanup()` 호출하여 해당 WAL 엔트리 정리
- Confirm 완료 후 `releaseLock()` 호출

**파일:** `src/app/payment/fail/page.tsx`
- 진입 시 `releaseLock()` 호출하여 잠금 해제

### 12-4. 네트워크 오프라인 처리

**파일:** `src/hooks/useOnlineStatus.ts`

- `navigator.onLine` + `online`/`offline` 이벤트 리스너
- `isOnline` 상태 반환

**파일:** `src/components/common/OfflineBanner.tsx`

- 오프라인 시 상단 배너 표시: "인터넷 연결이 끊어졌습니다"
- `POSClientShell`, `KioskShell`, `TableOrderShell`에 배치

**결제 차단:**
- `usePayment.startPayment()` 시작 시 `navigator.onLine` 확인 → 오프라인이면 즉시 에러

**React-Query 연동:**
- `QueryClient` 설정에 `refetchOnReconnect: true` (기본값이지만 명시)

### 12-5. 검증

- 탭 2개에서 동시 결제 시도 → 두 번째 탭 "다른 탭에서 결제 진행 중" 경고
- 결제 성공 페이지 새로고침 → confirm 중복 호출 안 됨 (네트워크 탭에서 1회만 확인)
- 네트워크 차단(DevTools) → 결제 시도 → "인터넷 연결 확인" 에러 메시지
- 오프라인 배너 표시 → 온라인 복구 시 배너 사라짐 + 데이터 자동 리페치
- 결제 중 새로고침 → 복구 배너 + 자동 복구 (Phase 9에서 구현)
- 백엔드 에러 핸들러: Prisma/Toss/미처리 예외 각각 적절한 HTTP 상태코드 반환

---

## Phase 13. 테스트

> **목표:** 핵심 비즈니스 로직 유닛 테스트 + API 통합 테스트

### 13-1. 백엔드 테스트 환경 설정

**의존성:** `pytest`, `pytest-asyncio` (requirements.txt에 이미 포함), `httpx` (FastAPI TestClient용)

**`backend/tests/conftest.py`**
- 테스트용 Prisma 클라이언트: 별도 SQLite (`file:./test.db`)
- Prisma connect/disconnect: `session` scope fixture (세션당 1회 연결)
- `seed_menus` fixture: 테스트용 메뉴 3개 생성 (커피 4500, 라떼 5500, 크루아상 4000)
- `client` fixture: `httpx.AsyncClient(transport=ASGITransport(app))` (async 지원)
- `mock_toss` fixture: `unittest.mock.AsyncMock`으로 `toss_client`의 3개 메서드 패치

**중요:** FastAPI `TestClient`는 동기식이므로 async 테스트에는 `httpx.AsyncClient` + `ASGITransport`를 사용.
Prisma DB가 테스트간 격리되도록 각 테스트 후 Order/Payment/WebhookEvent 테이블 truncate.

**`backend/pytest.ini` 또는 `pyproject.toml`**
```ini
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

### 13-2. 백엔드 주문 테스트

**`backend/tests/test_orders.py`** (6개 케이스)
- 주문 생성 성공 — 메뉴 2개 주문, 금액 = sum(price × quantity), orderNumber 자동 채번
- 주문 생성 — 존재하지 않는 메뉴 ID → 404
- 주문 목록 조회 — 전체 + `?status=PENDING` 필터
- 주문 상세 조회 — items, payment 포함 확인
- 주문 취소 — PENDING → CANCELLED 성공
- 주문 취소 — PAID 상태에서 시도 → 400

### 13-3. 백엔드 결제 테스트

**`backend/tests/test_payments.py`** (5개 케이스, Toss API mock)
- 결제 confirm 성공 — toss_client.confirm_payment mock → Payment DONE, Order PAID
- 결제 confirm 금액 불일치 → 400
- 결제 confirm 이미 PAID 상태 → 400
- 결제 상태 조회 — GET /api/payments/{orderId}
- 결제 취소 — toss_client.cancel_payment mock → Payment CANCELED, Order CANCELLED

### 13-4. 백엔드 멱등성 테스트

**`backend/tests/test_idempotency.py`** (3개 케이스)
- 동일 Idempotency-Key 두 번 전송 → 두 번째 응답 = 첫 번째와 동일 (핸들러 1회만 실행)
- Idempotency-Key 없는 POST → 미들웨어 무시, 정상 처리
- 다른 Idempotency-Key → 각각 별도 처리

### 13-5. 백엔드 웹훅 테스트

**`backend/tests/test_webhooks.py`** (4개 케이스)
- 유효한 웹훅 → WebhookEvent 레코드 생성 + Payment/Order 상태 업데이트
- 잘못된 시크릿 → 무시 (status: ok, DB 변경 없음)
- 중복 웹훅 (같은 paymentKey + eventType, processed=true) → 무시
- paymentKey 누락 → 무시

### 13-6. 프론트엔드 테스트 환경 설정

**Vitest 설치:** `npm install -D vitest`
**`frontend/vitest.config.ts`**
```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",   // DOM 불필요 (순수 로직 테스트)
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

### 13-7. 프론트엔드 paymentReducer 테스트

**`frontend/src/__tests__/hooks/paymentReducer.test.ts`** (4개 그룹)
- 정상 플로우: IDLE → WAL_WRITING → ORDER_CREATING → TOSS_POPUP → CONFIRMING → DONE
- 에러 + 재시도: → ERROR → RETRYING → DONE
- 복구 불가: → ERROR → NEEDS_RECOVERY
- 리셋: DONE/CANCELLED/NEEDS_RECOVERY → RESET → IDLE
- 잘못된 전이: 현재 상태 유지 (예: IDLE + CONFIRM_SUCCESS → IDLE)

### 13-8. 프론트엔드 WALManager 테스트

**`frontend/src/__tests__/services/WALManager.test.ts`** (6개 케이스)
- write → readAll로 확인
- update → 부분 업데이트 + updatedAt 갱신
- remove → 삭제 확인
- getPending → 터미널 상태(DONE, CANCELLED, IDLE) 제외
- cleanup → maxAge 초과 엔트리 제거
- readAll — localStorage 비정상 데이터 → 빈 배열 반환

**Mock:** localStorage를 전역 mock (Map 기반 shim)

### 13-9. 프론트엔드 cartReducer 테스트

**`frontend/src/__tests__/hooks/cartReducer.test.ts`** (5개 케이스)
- ADD_ITEM — 새 아이템 추가, 기존 아이템 수량 +1
- REMOVE_ITEM — 아이템 삭제
- UPDATE_QUANTITY — 수량 변경, 0 이하 시 삭제
- SET_ORDER_MODE — DINE_IN ↔ TAKE_OUT
- CLEAR — 전체 초기화, totalAmount = 0

```bash
# 백엔드
cd backend && pytest -v

# 프론트엔드
cd frontend && npx vitest run
```

---

## Phase 14. 마무리 & 배포 준비

> **목표:** .gitignore 정비, npm scripts 추가, 백엔드 에러 메시지 한글화 점검, 최종 E2E 검증

### 14-1. .gitignore 정비 + pycache 정리

현재 문제:
- `__pycache__/` 디렉토리가 git에 추적되고 있음 (`.pyc` 파일 커밋됨)
- `backend/prisma/test.db` (테스트 DB)가 미무시
- docs/ 디렉토리가 미무시 (의도적 포함 가능)

수정:
- 루트 `.gitignore`에 `__pycache__/`, `*.pyc`, `backend/prisma/test.db`, `.pytest_cache/` 추가
- 이미 추적 중인 `__pycache__/` 파일을 `git rm --cached -r` 로 인덱스에서 제거

### 14-2. npm scripts 추가

**파일:** `frontend/package.json`

현재 scripts에 `test`가 없음. 추가:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### 14-3. 백엔드 에러 메시지 한글화 점검

현재 영어 메시지를 사용하는 곳:
- `OrderService`: "Menu not found", "Order not found", "Cannot cancel order in..."
- `PaymentService`: "Order not found", "Amount mismatch...", "Payment not found..."
- 라우터 HTTPException 메시지들

한글화 대상:
- 사용자에게 노출될 수 있는 에러 메시지 → 한글
- 내부 로깅 / 디버그 메시지 → 영어 유지 (로그 검색 용이)

### 14-4. 환경 전환 준비

이미 실제 Toss 테스트 키 사용 중 (`NEXT_PUBLIC_PAYMENT_MOCK="false"`). 추가 확인:
- [ ] PostgreSQL 전환 시 `schema.prisma`에서 `provider = "postgresql"` 변경 + `DATABASE_URL` 수정
- [ ] CORS_ORIGINS을 프로덕션 도메인으로 변경

### 14-5. 최종 검증 체크리스트

**POS (/):**
- [ ] 메뉴 조회 → 카테고리 탭 전환 → 장바구니 추가
- [ ] 매장/포장 토글 동작
- [ ] 결제하기 → Toss 결제 플로우 → POS로 복귀

**키오스크 (/kiosk):**
- [ ] 고객용 큰 메뉴 카드 표시
- [ ] 메뉴 선택 → 하단 장바구니 바 업데이트
- [ ] 주문하기 → 결제 → 키오스크 복귀

**테이블오더 (/order/[tableId]):**
- [ ] 테이블 번호 표시 (URL 파라미터 기반)
- [ ] 모바일 레이아웃 정상 렌더링
- [ ] 주문하기 → 결제 → 테이블오더 복귀

**결제 & 안정성:**
- [ ] 결제 중 새로고침 → RecoveryBanner → 자동 복구
- [ ] 동일 멱등성 키 재전송 → 중복 주문 없음
- [ ] 중복 탭 결제 차단
- [ ] 오프라인 시 결제 시도 → "인터넷 연결 확인" 에러

**관리자:**
- [ ] `/admin` → 매출 요약 카드 + 주문 목록 (출처 뱃지: POS/KIOSK/TABLE)
- [ ] 상태 필터 전환 → 해당 주문만 표시
- [ ] 주문 클릭 → 상세 모달 (PAID 주문 취소 가능)
- [ ] `/admin/orders` (KDS) → 칸반 보드, 접수→준비중→완료 상태 전환

**공통:**
- [ ] 테마 전환 (light ↔ dark) + 새로고침 후 유지
- [ ] 백엔드 미실행 시 에러 UI 표시 (error.tsx)
- [ ] 서버 컴포넌트 → 클라이언트 셸 패턴 정상 작동
- [ ] `cd backend && pytest -v` 전체 통과
- [ ] `cd frontend && npx vitest run` 전체 통과
- [ ] `cd frontend && npm run build` 성공

---

## 의존성 다이어그램

```
Phase 1  프로젝트 초기화
   │
   ├──→ Phase 2  백엔드 기반 (DB, 스키마, 앱 엔트리)
   │       │
   │       └──→ Phase 3  메뉴 & 주문 API
   │               │
   │               ├──→ Phase 6  결제 API & Toss 연동
   │               │       │
   │               │       └──→ Phase 10  웹훅 핸들러
   │               │
   │               └──→ Phase 8 (백엔드)  멱등성 미들웨어
   │
   └──→ Phase 4  프론트엔드 기반 (렌더링 전략, SC/CC, Provider, 테마, API 클라이언트)
           │
           └──→ Phase 5  POS + 키오스크 + 테이블오더
                   │
                   ├──→ Phase 7  결제 추상화 & 다중 제품 결제 페이지
                   │       │
                   │       ├──→ Phase 8 (프론트)  멱등성 키
                   │       │
                   │       ├──→ Phase 9  상태 머신 & WAL & 복구
                   │       │
                   │       └──→ Phase 12  중복 탭 & 엣지 케이스
                   │
                   └──→ Phase 11  관리자 대시보드 고도화 & KDS 보드

Phase 13  테스트 (모든 Phase 완료 후)
Phase 14  마무리 (테스트 통과 후)
```

### 토스플레이스 제품 → 구현 Phase 매핑

| 토스플레이스 제품 | 기본 구조 | 결제 연동 | 고도화 |
|---|---|---|---|
| **POS** | Phase 5 | Phase 7 | Phase 9 (WAL 복구) |
| **키오스크** | Phase 5 | Phase 7 | Phase 12 (엣지 케이스) |
| **테이블오더** | Phase 5 | Phase 7 | Phase 12 (엣지 케이스) |
| **관리자 대시보드** | Phase 4 (스텁) | — | Phase 11 (구현) |
| **KDS (주문현황)** | Phase 4 (스텁) | — | Phase 11 (칸반 보드) |
