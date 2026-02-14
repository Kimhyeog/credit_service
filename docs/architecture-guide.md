# Toss-Sync POS: 실시간 결제 및 자동 복구 시스템

## 아키텍처 & 단계별 구현 가이드

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [디렉토리 구조](#2-디렉토리-구조)
3. [데이터베이스 설계](#3-데이터베이스-설계)
4. [API 엔드포인트 설계](#4-api-엔드포인트-설계)
5. [프론트엔드 컴포넌트 아키텍처](#5-프론트엔드-컴포넌트-아키텍처)
6. [결제 추상화 레이어](#6-결제-추상화-레이어)
7. [결제 상태 머신 & 에러 복구](#7-결제-상태-머신--에러-복구)
8. [React-Query 전략](#8-react-query-전략)
9. [테마 시스템](#9-테마-시스템)
10. [멱등성 보장](#10-멱등성-보장)
11. [엣지 케이스 시나리오](#11-엣지-케이스-시나리오)
12. [3일 단계별 구현 가이드](#12-3일-단계별-구현-가이드)

---

## 1. 시스템 개요

### 1.1 프로젝트 목표

Toss-Sync POS는 소규모 매장을 위한 **실시간 결제 처리 시스템**이다. 결제 중 네트워크 장애, 브라우저 크래시 등 장애 상황에서도 **데이터 무결성을 보장**하고, 미완료 결제를 **자동으로 복구**한다.

### 1.2 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프론트엔드 | Next.js 14 (App Router), TypeScript, Emotion, React-Query v5 |
| 백엔드 | FastAPI (Python 3.11+), Uvicorn |
| ORM / DB | Prisma (Python client), SQLite (개발) / PostgreSQL (운영) |
| 결제 | Toss Payments API (테스트 키) |
| 상태 관리 | React-Query + LocalStorage WAL |
| 테스트 | Vitest (프론트), Pytest (백엔드) |

### 1.3 전체 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                        클라이언트 (브라우저)                          │
│                                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ POS 화면 │  │ 결제 플로우   │  │ 관리자 대시보드│  │ 테마 토글  │  │
│  └────┬─────┘  └──────┬───────┘  └──────┬───────┘  └────────────┘  │
│       │               │                 │                           │
│  ┌────▼───────────────▼─────────────────▼──────────────────────┐   │
│  │              React-Query (캐시 + 폴링 + 낙관적 업데이트)      │   │
│  └────┬────────────────────────────────────────────────────────┘   │
│       │                                                             │
│  ┌────▼────────────────────────────────────────────────────────┐   │
│  │  PaymentService (Strategy 패턴)                              │   │
│  │  ├─ TossPaymentStrategy                                      │   │
│  │  └─ MockPaymentStrategy (테스트용)                            │   │
│  └────┬────────────────────────────────────────────────────────┘   │
│       │                                                             │
│  ┌────▼────────────────────────────────────────────────────────┐   │
│  │  LocalStorage WAL (Write-Ahead Log)                          │   │
│  │  → 결제 인텐트 기록 → 브라우저 크래시 시 복구 근거             │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────────┘
                         │  HTTP / WebSocket
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        백엔드 (FastAPI)                              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Orders API   │  │ Payments API │  │ Idempotency Middleware   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘  │
│         │                 │                                         │
│  ┌──────▼─────────────────▼────────────────────────────────────┐   │
│  │              Prisma ORM                                      │   │
│  └──────┬──────────────────────────────────────────────────────┘   │
│         │                                                           │
│  ┌──────▼──────────────────────────────────────────────────────┐   │
│  │              SQLite / PostgreSQL                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Webhook Handler (Toss → 서버)                               │   │
│  │  → 결제 확정/실패 비동기 수신                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Toss Payments API (외부)                          │
│  - POST /v1/payments/confirm                                        │
│  - Webhook → POST /api/webhooks/toss                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.4 데이터 흐름 요약

```
[사용자 주문] → POS 화면에서 메뉴 선택
    → [주문 생성] POST /api/orders (idempotency-key 포함)
    → [결제 시작] LocalStorage WAL에 인텐트 기록
    → [Toss 결제창] 사용자가 결제 승인
    → [결제 확인] POST /api/payments/confirm
    → [Webhook 수신] Toss → POST /api/webhooks/toss
    → [주문 완료] 상태 업데이트 → POS 화면 반영
```

---

## 2. 디렉토리 구조

```
credit_service/
├── CLAUDE.md
├── docs/
│   └── architecture-guide.md        # 본 문서
│
├── frontend/                         # Next.js 14 (App Router)
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── public/
│   ├── src/
│   │   ├── app/                      # App Router 페이지
│   │   │   ├── layout.tsx            # 루트 레이아웃 (Providers 래핑)
│   │   │   ├── page.tsx              # POS 메인 화면
│   │   │   ├── payment/
│   │   │   │   ├── page.tsx          # 결제 진행 화면
│   │   │   │   └── success/page.tsx  # 결제 성공 콜백
│   │   │   │   └── fail/page.tsx     # 결제 실패 콜백
│   │   │   └── admin/
│   │   │       └── page.tsx          # 관리자 대시보드
│   │   │
│   │   ├── components/               # UI 컴포넌트
│   │   │   ├── pos/
│   │   │   │   ├── MenuGrid.tsx
│   │   │   │   ├── MenuItem.tsx
│   │   │   │   ├── Cart.tsx
│   │   │   │   ├── CartItem.tsx
│   │   │   │   └── OrderSummary.tsx
│   │   │   ├── payment/
│   │   │   │   ├── PaymentButton.tsx
│   │   │   │   ├── PaymentStatus.tsx
│   │   │   │   └── RecoveryBanner.tsx
│   │   │   ├── admin/
│   │   │   │   ├── OrderList.tsx
│   │   │   │   ├── OrderDetail.tsx
│   │   │   │   └── SalesChart.tsx
│   │   │   └── common/
│   │   │       ├── Button.tsx
│   │   │       ├── Modal.tsx
│   │   │       ├── Toast.tsx
│   │   │       └── ThemeToggle.tsx
│   │   │
│   │   ├── providers/                # Context / Provider 계층
│   │   │   ├── AppProviders.tsx       # 모든 Provider 조합
│   │   │   ├── QueryProvider.tsx      # React-Query
│   │   │   ├── ThemeProvider.tsx      # Emotion 테마
│   │   │   └── CartProvider.tsx       # 장바구니 상태
│   │   │
│   │   ├── services/                 # 비즈니스 로직
│   │   │   ├── payment/
│   │   │   │   ├── PaymentService.ts          # Strategy 인터페이스
│   │   │   │   ├── TossPaymentStrategy.ts     # Toss 구현체
│   │   │   │   └── MockPaymentStrategy.ts     # 테스트 구현체
│   │   │   ├── recovery/
│   │   │   │   ├── RecoveryService.ts         # 자동 복구
│   │   │   │   └── WALManager.ts              # LocalStorage WAL
│   │   │   └── api.ts                         # API 클라이언트 (fetch 래퍼)
│   │   │
│   │   ├── hooks/                    # 커스텀 훅
│   │   │   ├── useOrders.ts
│   │   │   ├── usePayment.ts
│   │   │   ├── useCart.ts
│   │   │   ├── useRecovery.ts
│   │   │   └── useIdempotencyKey.ts
│   │   │
│   │   ├── styles/                   # Emotion 테마
│   │   │   ├── theme.ts              # light / dark 테마 정의
│   │   │   ├── global.ts             # 글로벌 스타일
│   │   │   └── styled.d.ts           # 테마 타입 확장
│   │   │
│   │   ├── types/                    # 공유 타입
│   │   │   ├── order.ts
│   │   │   ├── payment.ts
│   │   │   ├── menu.ts
│   │   │   └── api.ts
│   │   │
│   │   └── utils/
│   │       ├── idempotency.ts        # 멱등성 키 생성
│   │       ├── formatCurrency.ts
│   │       └── constants.ts
│   │
│   └── __tests__/                    # Vitest 테스트
│       ├── services/
│       ├── hooks/
│       └── components/
│
├── backend/                          # FastAPI
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── prisma/
│   │   └── schema.prisma             # DB 스키마
│   ├── app/
│   │   ├── main.py                   # FastAPI 앱 엔트리
│   │   ├── config.py                 # 환경 설정
│   │   ├── routers/
│   │   │   ├── orders.py             # 주문 CRUD
│   │   │   ├── payments.py           # 결제 처리
│   │   │   ├── menus.py              # 메뉴 CRUD
│   │   │   └── webhooks.py           # Toss 웹훅
│   │   ├── services/
│   │   │   ├── order_service.py
│   │   │   ├── payment_service.py
│   │   │   └── toss_client.py        # Toss API HTTP 클라이언트
│   │   ├── middleware/
│   │   │   ├── idempotency.py        # 멱등성 미들웨어
│   │   │   └── error_handler.py      # 글로벌 에러 핸들러
│   │   ├── models/
│   │   │   └── schemas.py            # Pydantic 스키마
│   │   └── db/
│   │       └── client.py             # Prisma 클라이언트 초기화
│   │
│   └── tests/                        # Pytest 테스트
│       ├── conftest.py
│       ├── test_orders.py
│       ├── test_payments.py
│       └── test_idempotency.py
│
└── docker-compose.yml                # (선택) 로컬 개발 환경
```

---

## 3. 데이터베이스 설계

### 3.1 Prisma 스키마

```prisma
// backend/prisma/schema.prisma

generator client {
  provider             = "prisma-client-py"
  recursive_type_depth = 5
}

datasource db {
  provider = "sqlite"       // 개발: sqlite, 운영: postgresql
  url      = env("DATABASE_URL")
}

// ─── 메뉴 ───────────────────────────────────────────

model Menu {
  id          String   @id @default(cuid())
  name        String
  price       Int                // 원 단위
  category    String
  imageUrl    String?
  isAvailable Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  orderItems  OrderItem[]
}

// ─── 주문 ───────────────────────────────────────────

model Order {
  id              String      @id @default(cuid())
  orderNumber     Int         @unique @default(autoincrement())
  status          OrderStatus @default(PENDING)
  totalAmount     Int
  idempotencyKey  String      @unique       // 프론트에서 생성
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  items           OrderItem[]
  payment         Payment?
}

model OrderItem {
  id       String @id @default(cuid())
  quantity Int
  price    Int                              // 주문 시점 가격 스냅샷

  orderId  String
  order    Order  @relation(fields: [orderId], references: [id])

  menuId   String
  menu     Menu   @relation(fields: [menuId], references: [id])
}

enum OrderStatus {
  PENDING          // 주문 생성됨
  PAYMENT_PENDING  // 결제 진행 중
  PAID             // 결제 완료
  CANCELLED        // 취소됨
  REFUNDED         // 환불됨
  FAILED           // 결제 실패
}

// ─── 결제 ───────────────────────────────────────────

model Payment {
  id              String        @id @default(cuid())
  paymentKey      String?       @unique     // Toss에서 발급
  method          String?                    // CARD, CASH 등
  status          PaymentStatus @default(READY)
  amount          Int
  approvedAt      DateTime?
  failReason      String?
  rawResponse     String?                    // Toss 응답 JSON (디버깅용)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  orderId         String        @unique
  order           Order         @relation(fields: [orderId], references: [id])
}

enum PaymentStatus {
  READY             // 결제 준비
  IN_PROGRESS       // 결제 진행 중
  DONE              // 결제 완료
  CANCELED          // 취소
  PARTIAL_CANCELED  // 부분 취소
  ABORTED           // 승인 실패
  EXPIRED           // 만료
}

// ─── 멱등성 ─────────────────────────────────────────

model IdempotencyRecord {
  id             String   @id @default(cuid())
  idempotencyKey String   @unique
  httpMethod     String                     // POST, PUT 등
  path           String                     // /api/orders 등
  statusCode     Int                        // 최초 응답 코드
  responseBody   String                     // 최초 응답 JSON
  createdAt      DateTime @default(now())
  expiresAt      DateTime                   // TTL (기본 24시간)
}

// ─── 웹훅 이벤트 ────────────────────────────────────

model WebhookEvent {
  id          String   @id @default(cuid())
  eventType   String                        // PAYMENT_STATUS_CHANGED 등
  paymentKey  String
  payload     String                        // Raw JSON
  processed   Boolean  @default(false)
  processedAt DateTime?
  createdAt   DateTime @default(now())
}
```

### 3.2 ERD (텍스트)

```
Menu ─┐
      │ 1:N
      ▼
OrderItem ◄── N:1 ── Order ── 1:1 ── Payment
                        │
                        └── idempotencyKey (unique)

IdempotencyRecord (독립 테이블 — HTTP 레벨 중복 방지)
WebhookEvent      (독립 테이블 — 웹훅 감사 로그)
```

---

## 4. API 엔드포인트 설계

### 4.1 라우트 전체 목록

| Method | Path | 설명 | 멱등성 키 | 인증 |
|--------|------|------|-----------|------|
| **메뉴** | | | | |
| GET | `/api/menus` | 메뉴 목록 조회 | - | - |
| POST | `/api/menus` | 메뉴 등록 | - | Admin |
| PUT | `/api/menus/{id}` | 메뉴 수정 | - | Admin |
| DELETE | `/api/menus/{id}` | 메뉴 삭제 (soft) | - | Admin |
| **주문** | | | | |
| GET | `/api/orders` | 주문 목록 (필터, 페이지네이션) | - | - |
| GET | `/api/orders/{id}` | 주문 상세 | - | - |
| POST | `/api/orders` | 주문 생성 | `Idempotency-Key` | - |
| PATCH | `/api/orders/{id}/cancel` | 주문 취소 | `Idempotency-Key` | - |
| **결제** | | | | |
| POST | `/api/payments/confirm` | 결제 승인 요청 (Toss confirm) | `Idempotency-Key` | - |
| GET | `/api/payments/{orderId}` | 결제 상태 조회 | - | - |
| POST | `/api/payments/{orderId}/cancel` | 결제 취소 | `Idempotency-Key` | - |
| **웹훅** | | | | |
| POST | `/api/webhooks/toss` | Toss 결제 웹훅 수신 | - | Toss 서명 검증 |
| **시스템** | | | | |
| GET | `/api/health` | 헬스체크 | - | - |

### 4.2 주요 API 스키마 예시

```python
# backend/app/models/schemas.py

from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class OrderItemCreate(BaseModel):
    menu_id: str
    quantity: int = Field(ge=1)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate]
    idempotency_key: str = Field(min_length=16, max_length=64)


class OrderResponse(BaseModel):
    id: str
    order_number: int
    status: str
    total_amount: int
    items: list[dict]
    created_at: datetime

    model_config = {"from_attributes": True}


class PaymentConfirmRequest(BaseModel):
    payment_key: str
    order_id: str
    amount: int


class PaymentResponse(BaseModel):
    id: str
    payment_key: str | None
    status: str
    amount: int
    method: str | None
    approved_at: datetime | None

    model_config = {"from_attributes": True}
```

### 4.3 주문 생성 라우터 예시

```python
# backend/app/routers/orders.py

from fastapi import APIRouter, Header, HTTPException
from app.models.schemas import OrderCreate, OrderResponse
from app.services.order_service import OrderService
from app.db.client import get_db

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.post("", response_model=OrderResponse, status_code=201)
async def create_order(
    body: OrderCreate,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    db = get_db()
    service = OrderService(db)

    # 멱등성은 미들웨어에서 처리하므로 여기선 비즈니스 로직만
    order = await service.create_order(
        items=body.items,
        idempotency_key=idempotency_key,
    )
    return order
```

---

## 5. 프론트엔드 컴포넌트 아키텍처

### 5.1 Provider 계층 (바깥 → 안쪽)

```
<QueryProvider>               ← React-Query
  <ThemeProvider>              ← Emotion 테마 (light/dark)
    <CartProvider>             ← 장바구니 상태 (useReducer)
      <Layout>                 ← 공통 레이아웃 (헤더, 사이드바)
        {children}             ← 페이지 컴포넌트
      </Layout>
    </CartProvider>
  </ThemeProvider>
</QueryProvider>
```

```typescript
// src/providers/AppProviders.tsx

"use client";

import { QueryProvider } from "./QueryProvider";
import { ThemeProvider } from "./ThemeProvider";
import { CartProvider } from "./CartProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <CartProvider>
          {children}
        </CartProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
```

### 5.2 페이지 구조 (App Router)

```
/                          → POS 메인 (메뉴 그리드 + 장바구니)
/payment                   → 결제 진행 화면
/payment/success?orderId=  → 결제 성공 콜백
/payment/fail?code=&msg=   → 결제 실패 콜백
/admin                     → 관리자 대시보드
```

### 5.3 컴포넌트 트리 (POS 메인 화면)

```
page.tsx (POS)
├── RecoveryBanner           ← 미완료 결제 복구 배너 (조건부)
├── MenuGrid
│   └── MenuItem (반복)      ← 메뉴 카드 (이미지, 이름, 가격)
│       └── onClick → cart.addItem()
├── Cart
│   ├── CartItem (반복)      ← 수량 조절, 삭제
│   ├── OrderSummary          ← 합계 금액
│   └── PaymentButton         ← "결제하기" → /payment 이동
└── ThemeToggle               ← 우상단 테마 전환
```

### 5.4 CartProvider 상세

```typescript
// src/providers/CartProvider.tsx

"use client";

import { createContext, useContext, useReducer, ReactNode } from "react";
import { MenuItem } from "@/types/menu";

interface CartItem {
  menu: MenuItem;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  totalAmount: number;
}

type CartAction =
  | { type: "ADD_ITEM"; menu: MenuItem }
  | { type: "REMOVE_ITEM"; menuId: string }
  | { type: "UPDATE_QUANTITY"; menuId: string; quantity: number }
  | { type: "CLEAR" };

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const existing = state.items.find((i) => i.menu.id === action.menu.id);
      const items = existing
        ? state.items.map((i) =>
            i.menu.id === action.menu.id
              ? { ...i, quantity: i.quantity + 1 }
              : i
          )
        : [...state.items, { menu: action.menu, quantity: 1 }];
      return { items, totalAmount: calcTotal(items) };
    }
    case "REMOVE_ITEM": {
      const items = state.items.filter((i) => i.menu.id !== action.menuId);
      return { items, totalAmount: calcTotal(items) };
    }
    case "UPDATE_QUANTITY": {
      if (action.quantity <= 0) {
        return cartReducer(state, { type: "REMOVE_ITEM", menuId: action.menuId });
      }
      const items = state.items.map((i) =>
        i.menu.id === action.menuId ? { ...i, quantity: action.quantity } : i
      );
      return { items, totalAmount: calcTotal(items) };
    }
    case "CLEAR":
      return { items: [], totalAmount: 0 };
    default:
      return state;
  }
}

function calcTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.menu.price * i.quantity, 0);
}

const CartContext = createContext<{
  state: CartState;
  dispatch: React.Dispatch<CartAction>;
} | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items: [],
    totalAmount: 0,
  });

  return (
    <CartContext.Provider value={{ state, dispatch }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
```

---

## 6. 결제 추상화 레이어

### 6.1 Strategy 패턴 설계

```
          ┌─────────────────────┐
          │  PaymentService     │ (인터페이스)
          │  ─────────────────  │
          │  + requestPayment() │
          │  + confirmPayment() │
          │  + cancelPayment()  │
          │  + getStatus()      │
          └──────────┬──────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
┌─────────▼──────────┐ ┌───────▼────────────┐
│ TossPaymentStrategy│ │ MockPaymentStrategy│
│ (실제 Toss API)     │ │ (테스트/개발용)      │
└────────────────────┘ └────────────────────┘
```

### 6.2 인터페이스 정의

```typescript
// src/services/payment/PaymentService.ts

export interface PaymentRequest {
  orderId: string;
  orderName: string;
  amount: number;
  idempotencyKey: string;
}

export interface PaymentConfirmation {
  paymentKey: string;
  orderId: string;
  amount: number;
}

export interface PaymentResult {
  success: boolean;
  paymentKey?: string;
  status: string;
  message?: string;
}

export interface PaymentService {
  /** 결제창 실행 (Toss SDK 호출 or 모의) */
  requestPayment(request: PaymentRequest): Promise<void>;

  /** 결제 승인 (서버 → Toss confirm API) */
  confirmPayment(confirmation: PaymentConfirmation): Promise<PaymentResult>;

  /** 결제 취소 */
  cancelPayment(paymentKey: string, reason: string): Promise<PaymentResult>;

  /** 결제 상태 조회 */
  getStatus(orderId: string): Promise<PaymentResult>;
}
```

### 6.3 Toss 구현체

```typescript
// src/services/payment/TossPaymentStrategy.ts

import { loadTossPayments } from "@tosspayments/payment-sdk";
import type {
  PaymentService,
  PaymentRequest,
  PaymentConfirmation,
  PaymentResult,
} from "./PaymentService";
import { api } from "../api";

const TOSS_CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!;

export class TossPaymentStrategy implements PaymentService {
  async requestPayment(req: PaymentRequest): Promise<void> {
    const toss = await loadTossPayments(TOSS_CLIENT_KEY);
    await toss.requestPayment("카드", {
      amount: req.amount,
      orderId: req.orderId,
      orderName: req.orderName,
      successUrl: `${window.location.origin}/payment/success`,
      failUrl: `${window.location.origin}/payment/fail`,
    });
  }

  async confirmPayment(conf: PaymentConfirmation): Promise<PaymentResult> {
    const res = await api.post("/api/payments/confirm", {
      payment_key: conf.paymentKey,
      order_id: conf.orderId,
      amount: conf.amount,
    });
    return {
      success: res.status === "DONE",
      paymentKey: res.payment_key,
      status: res.status,
    };
  }

  async cancelPayment(
    paymentKey: string,
    reason: string
  ): Promise<PaymentResult> {
    const res = await api.post(`/api/payments/${paymentKey}/cancel`, {
      reason,
    });
    return { success: true, status: res.status };
  }

  async getStatus(orderId: string): Promise<PaymentResult> {
    const res = await api.get(`/api/payments/${orderId}`);
    return {
      success: res.status === "DONE",
      paymentKey: res.payment_key,
      status: res.status,
    };
  }
}
```

### 6.4 Mock 구현체 (테스트용)

```typescript
// src/services/payment/MockPaymentStrategy.ts

import type {
  PaymentService,
  PaymentRequest,
  PaymentConfirmation,
  PaymentResult,
} from "./PaymentService";

export class MockPaymentStrategy implements PaymentService {
  private shouldFail: boolean;

  constructor(options?: { shouldFail?: boolean }) {
    this.shouldFail = options?.shouldFail ?? false;
  }

  async requestPayment(req: PaymentRequest): Promise<void> {
    // 즉시 success 콜백 URL로 리다이렉트 시뮬레이션
    const params = new URLSearchParams({
      paymentKey: `mock_pk_${Date.now()}`,
      orderId: req.orderId,
      amount: String(req.amount),
    });
    window.location.href = `/payment/success?${params}`;
  }

  async confirmPayment(conf: PaymentConfirmation): Promise<PaymentResult> {
    if (this.shouldFail) {
      return { success: false, status: "ABORTED", message: "Mock failure" };
    }
    return {
      success: true,
      paymentKey: conf.paymentKey,
      status: "DONE",
    };
  }

  async cancelPayment(): Promise<PaymentResult> {
    return { success: true, status: "CANCELED" };
  }

  async getStatus(orderId: string): Promise<PaymentResult> {
    return {
      success: true,
      paymentKey: `mock_pk_${orderId}`,
      status: "DONE",
    };
  }
}
```

### 6.5 팩토리

```typescript
// src/services/payment/index.ts

import type { PaymentService } from "./PaymentService";
import { TossPaymentStrategy } from "./TossPaymentStrategy";
import { MockPaymentStrategy } from "./MockPaymentStrategy";

export function createPaymentService(): PaymentService {
  if (process.env.NEXT_PUBLIC_PAYMENT_MOCK === "true") {
    return new MockPaymentStrategy();
  }
  return new TossPaymentStrategy();
}

export type { PaymentService } from "./PaymentService";
```

---

## 7. 결제 상태 머신 & 에러 복구

### 7.1 결제 상태 전이 다이어그램

```
                      ┌─────────┐
                      │  IDLE   │  초기 상태
                      └────┬────┘
                           │ 사용자가 "결제하기" 클릭
                           ▼
                    ┌──────────────┐
              ┌─────│ WAL_WRITING  │  LocalStorage에 인텐트 기록
              │     └──────┬───────┘
              │            │ WAL 기록 성공
              │            ▼
              │     ┌──────────────┐
              │     │ORDER_CREATING│  POST /api/orders
              │     └──────┬───────┘
              │            │ 주문 생성 성공 (orderId 받음)
              │            ▼
              │     ┌──────────────┐
              │     │ TOSS_POPUP   │  Toss 결제창 열림
              │     └──────┬───────┘
              │            │
              │     ┌──────┴──────────────────────┐
              │     │                              │
              │     ▼                              ▼
              │  ┌──────────┐              ┌────────────┐
              │  │CONFIRMING│  성공 콜백    │ USER_CANCEL│ 사용자가 결제창 닫음
              │  └────┬─────┘              └─────┬──────┘
              │       │                          │
              │       │ POST /confirm 성공       │ PATCH /cancel
              │       ▼                          ▼
              │  ┌──────────┐              ┌──────────┐
              │  │   DONE   │              │ CANCELLED│
              │  └──────────┘              └──────────┘
              │
              │  에러 발생 (어떤 단계에서든)
              ▼
       ┌─────────────┐
       │   ERROR     │
       └──────┬──────┘
              │
       ┌──────┴────────────────┐
       │                       │
       ▼                       ▼
┌─────────────┐         ┌───────────┐
│ RETRYING    │ 자동재시도│ NEEDS_    │ 수동 복구 필요
│ (자동 3회)   │         │ RECOVERY  │ (RecoveryBanner 표시)
└──────┬──────┘         └───────────┘
       │
       │ 재시도 성공 → CONFIRMING 또는 DONE
       │ 재시도 실패 → NEEDS_RECOVERY
       ▼
   (위 분기 반복)
```

### 7.2 상태 머신 코드

```typescript
// src/types/payment.ts

export type PaymentState =
  | "IDLE"
  | "WAL_WRITING"
  | "ORDER_CREATING"
  | "TOSS_POPUP"
  | "CONFIRMING"
  | "DONE"
  | "CANCELLED"
  | "ERROR"
  | "RETRYING"
  | "NEEDS_RECOVERY";

export type PaymentEvent =
  | { type: "START_PAYMENT" }
  | { type: "WAL_WRITTEN"; walId: string }
  | { type: "ORDER_CREATED"; orderId: string }
  | { type: "TOSS_SUCCESS"; paymentKey: string; orderId: string; amount: number }
  | { type: "TOSS_FAIL"; code: string; message: string }
  | { type: "USER_CANCEL" }
  | { type: "CONFIRM_SUCCESS" }
  | { type: "CONFIRM_FAIL"; error: string }
  | { type: "RETRY" }
  | { type: "RECOVERY_NEEDED" }
  | { type: "RESET" };

export function paymentReducer(
  state: PaymentState,
  event: PaymentEvent
): PaymentState {
  switch (state) {
    case "IDLE":
      if (event.type === "START_PAYMENT") return "WAL_WRITING";
      return state;

    case "WAL_WRITING":
      if (event.type === "WAL_WRITTEN") return "ORDER_CREATING";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "ORDER_CREATING":
      if (event.type === "ORDER_CREATED") return "TOSS_POPUP";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "TOSS_POPUP":
      if (event.type === "TOSS_SUCCESS") return "CONFIRMING";
      if (event.type === "TOSS_FAIL") return "ERROR";
      if (event.type === "USER_CANCEL") return "CANCELLED";
      return state;

    case "CONFIRMING":
      if (event.type === "CONFIRM_SUCCESS") return "DONE";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "ERROR":
      if (event.type === "RETRY") return "RETRYING";
      if (event.type === "RECOVERY_NEEDED") return "NEEDS_RECOVERY";
      if (event.type === "RESET") return "IDLE";
      return state;

    case "RETRYING":
      if (event.type === "CONFIRM_SUCCESS") return "DONE";
      if (event.type === "CONFIRM_FAIL") return "ERROR";
      return state;

    case "DONE":
    case "CANCELLED":
    case "NEEDS_RECOVERY":
      if (event.type === "RESET") return "IDLE";
      return state;

    default:
      return state;
  }
}
```

### 7.3 LocalStorage WAL (Write-Ahead Log)

결제 시작 전 반드시 WAL에 인텐트를 기록한다. 브라우저가 크래시되어도 다음 로드 시 WAL을 스캔하여 미완료 결제를 감지한다.

```typescript
// src/services/recovery/WALManager.ts

export interface WALEntry {
  id: string;                    // UUID v4
  orderId: string | null;        // 주문 생성 전이면 null
  paymentKey: string | null;     // Toss 결제창 전이면 null
  amount: number;
  items: { menuId: string; quantity: number }[];
  idempotencyKey: string;
  state: PaymentState;
  createdAt: number;             // Date.now()
  updatedAt: number;
}

const WAL_STORAGE_KEY = "toss_sync_pos_wal";

export class WALManager {
  /** WAL에 새 인텐트 기록 */
  write(entry: Omit<WALEntry, "id" | "createdAt" | "updatedAt">): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    const entries = this.readAll();
    entries.push({ ...entry, id, createdAt: now, updatedAt: now });
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
    return id;
  }

  /** 특정 WAL 엔트리 업데이트 */
  update(id: string, patch: Partial<WALEntry>): void {
    const entries = this.readAll().map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e
    );
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }

  /** 완료된 WAL 엔트리 삭제 */
  remove(id: string): void {
    const entries = this.readAll().filter((e) => e.id !== id);
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }

  /** 모든 WAL 엔트리 읽기 */
  readAll(): WALEntry[] {
    const raw = localStorage.getItem(WAL_STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** 미완료(복구 필요) 엔트리만 조회 */
  getPending(): WALEntry[] {
    const terminal: PaymentState[] = ["DONE", "CANCELLED", "IDLE"];
    return this.readAll().filter((e) => !terminal.includes(e.state));
  }

  /** 만료된 엔트리 정리 (24시간 이상) */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    const entries = this.readAll().filter((e) => e.createdAt > cutoff);
    localStorage.setItem(WAL_STORAGE_KEY, JSON.stringify(entries));
  }
}
```

### 7.4 RecoveryService

앱 로드 시 WAL을 스캔하고, 미완료 결제에 대해 서버 상태를 확인한 뒤 자동 복구를 시도한다.

```typescript
// src/services/recovery/RecoveryService.ts

import { WALManager, WALEntry } from "./WALManager";
import { api } from "../api";

export interface RecoveryResult {
  walId: string;
  orderId: string | null;
  action: "confirmed" | "cancelled" | "needs_manual" | "cleaned";
  message: string;
}

export class RecoveryService {
  private wal = new WALManager();

  async recoverAll(): Promise<RecoveryResult[]> {
    this.wal.cleanup();
    const pending = this.wal.getPending();
    const results: RecoveryResult[] = [];

    for (const entry of pending) {
      const result = await this.recoverOne(entry);
      results.push(result);
    }
    return results;
  }

  private async recoverOne(entry: WALEntry): Promise<RecoveryResult> {
    // Case 1: 주문조차 생성되지 않은 경우 → WAL 제거
    if (!entry.orderId) {
      this.wal.remove(entry.id);
      return {
        walId: entry.id,
        orderId: null,
        action: "cleaned",
        message: "주문 미생성 — WAL 정리됨",
      };
    }

    // Case 2: 서버에 주문/결제 상태 확인
    try {
      const payment = await api.get(`/api/payments/${entry.orderId}`);

      if (payment.status === "DONE") {
        // 이미 결제 완료 → WAL 제거
        this.wal.remove(entry.id);
        return {
          walId: entry.id,
          orderId: entry.orderId,
          action: "confirmed",
          message: "서버에서 결제 완료 확인됨",
        };
      }

      if (payment.status === "IN_PROGRESS" && entry.paymentKey) {
        // 결제 승인 재시도
        const confirmResult = await api.post("/api/payments/confirm", {
          payment_key: entry.paymentKey,
          order_id: entry.orderId,
          amount: entry.amount,
        });

        if (confirmResult.status === "DONE") {
          this.wal.remove(entry.id);
          return {
            walId: entry.id,
            orderId: entry.orderId,
            action: "confirmed",
            message: "결제 승인 재시도 성공",
          };
        }
      }

      // 그 외 → 수동 복구 필요
      this.wal.update(entry.id, { state: "NEEDS_RECOVERY" });
      return {
        walId: entry.id,
        orderId: entry.orderId,
        action: "needs_manual",
        message: `수동 확인 필요 (서버 상태: ${payment.status})`,
      };
    } catch {
      this.wal.update(entry.id, { state: "NEEDS_RECOVERY" });
      return {
        walId: entry.id,
        orderId: entry.orderId,
        action: "needs_manual",
        message: "서버 연결 실패 — 수동 확인 필요",
      };
    }
  }
}
```

---

## 8. React-Query 전략

### 8.1 QueryClient 설정

```typescript
// src/providers/QueryProvider.tsx

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,          // 5초 — POS 환경에서 적절한 신선도
            gcTime: 10 * 60_000,       // 10분 — 가비지 컬렉션
            retry: 2,                  // 2회 재시도
            refetchOnWindowFocus: true, // 탭 전환 시 리페치
          },
          mutations: {
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

### 8.2 주문 목록 폴링 (POS 실시간 업데이트)

```typescript
// src/hooks/useOrders.ts

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { OrderResponse } from "@/types/order";

const ORDERS_KEY = ["orders"] as const;

/** 주문 목록 — 3초 간격 폴링 */
export function useOrders(status?: string) {
  return useQuery<OrderResponse[]>({
    queryKey: [...ORDERS_KEY, { status }],
    queryFn: () => api.get("/api/orders", { params: { status } }),
    refetchInterval: 3_000,           // ← POS 폴링: 3초
    refetchIntervalInBackground: true, // 백그라운드에서도 폴링 유지
  });
}

/** 주문 상세 */
export function useOrder(orderId: string) {
  return useQuery<OrderResponse>({
    queryKey: [...ORDERS_KEY, orderId],
    queryFn: () => api.get(`/api/orders/${orderId}`),
    enabled: !!orderId,
  });
}
```

### 8.3 주문 생성 (낙관적 업데이트)

```typescript
// src/hooks/useCreateOrder.ts

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { OrderResponse } from "@/types/order";

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      items: { menu_id: string; quantity: number }[];
      idempotency_key: string;
    }) =>
      api.post("/api/orders", body, {
        headers: { "Idempotency-Key": body.idempotency_key },
      }),

    // 낙관적 업데이트: 서버 응답 전에 UI에 주문 추가
    onMutate: async (newOrder) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      const previous = queryClient.getQueryData<OrderResponse[]>(["orders"]);

      const optimistic: Partial<OrderResponse> = {
        id: `temp_${newOrder.idempotency_key}`,
        status: "PENDING",
        total_amount: 0, // 실제 계산은 서버에서
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<OrderResponse[]>(["orders"], (old = []) => [
        optimistic as OrderResponse,
        ...old,
      ]);

      return { previous };
    },

    // 성공: 실제 데이터로 교체
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },

    // 실패: 롤백
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["orders"], context.previous);
      }
    },
  });
}
```

### 8.4 결제 상태 폴링

```typescript
// src/hooks/usePayment.ts

import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";

/** 결제 상태 폴링 — 진행 중일 때만 1초 간격 */
export function usePaymentStatus(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["payment", orderId],
    queryFn: () => api.get(`/api/payments/${orderId}`),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // 터미널 상태이면 폴링 중단
      if (["DONE", "CANCELED", "ABORTED", "EXPIRED"].includes(status)) {
        return false;
      }
      return 1_000; // 1초 간격
    },
  });
}
```

---

## 9. 테마 시스템

### 9.1 테마 정의

```typescript
// src/styles/theme.ts

export const lightTheme = {
  mode: "light" as const,
  colors: {
    background: "#FFFFFF",
    surface: "#F5F5F5",
    surfaceHover: "#EEEEEE",
    text: {
      primary: "#1A1A1A",
      secondary: "#666666",
      disabled: "#AAAAAA",
    },
    primary: "#3182F6",         // Toss 블루
    primaryHover: "#1B64DA",
    danger: "#F04452",
    success: "#2BD67E",
    warning: "#FF9F00",
    border: "#E5E5E5",
    shadow: "rgba(0, 0, 0, 0.08)",
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
  },
  borderRadius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
  },
  fontSize: {
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "20px",
    xl: "24px",
    xxl: "32px",
  },
};

export const darkTheme: typeof lightTheme = {
  ...lightTheme,
  mode: "dark",
  colors: {
    ...lightTheme.colors,
    background: "#1A1A1A",
    surface: "#2A2A2A",
    surfaceHover: "#333333",
    text: {
      primary: "#F0F0F0",
      secondary: "#A0A0A0",
      disabled: "#666666",
    },
    border: "#3A3A3A",
    shadow: "rgba(0, 0, 0, 0.3)",
  },
};

export type AppTheme = typeof lightTheme;
```

### 9.2 Emotion 테마 타입 확장

```typescript
// src/styles/styled.d.ts

import "@emotion/react";
import type { AppTheme } from "./theme";

declare module "@emotion/react" {
  export interface Theme extends AppTheme {}
}
```

### 9.3 ThemeProvider

```typescript
// src/providers/ThemeProvider.tsx

"use client";

import { ThemeProvider as EmotionThemeProvider } from "@emotion/react";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { lightTheme, darkTheme, AppTheme } from "@/styles/theme";

type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  toggle: () => {},
});

const THEME_STORAGE_KEY = "toss_sync_pos_theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  // 초기 로드: localStorage 또는 시스템 설정 반영
  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (stored) {
      setMode(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setMode("dark");
    }
  }, []);

  const toggle = () => {
    setMode((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  const theme: AppTheme = mode === "light" ? lightTheme : darkTheme;

  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      <EmotionThemeProvider theme={theme}>{children}</EmotionThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeContext);
}
```

---

## 10. 멱등성 보장

### 10.1 전체 흐름

```
프론트엔드                         백엔드
─────────                         ──────
1. 멱등성 키 생성
   (UUID v4 + orderId hash)
          │
          │  POST /api/orders
          │  Header: Idempotency-Key: abc123
          ▼
                                  2. IdempotencyMiddleware
                                     ├─ DB에서 키 조회
                                     ├─ 존재 → 저장된 응답 반환 (재실행 없음)
                                     └─ 미존재 → 핸들러 실행 → 응답 저장
          │
          │  201 Created (주문 데이터)
          ◄─────────────────────────
```

### 10.2 프론트엔드: 멱등성 키 생성

```typescript
// src/utils/idempotency.ts

/**
 * 멱등성 키 생성
 * - 같은 장바구니 내용으로 재시도해도 동일한 키가 생성되어야 함
 * - 다른 주문은 다른 키가 나와야 함
 */
export function generateIdempotencyKey(
  items: { menuId: string; quantity: number }[]
): string {
  const payload = items
    .map((i) => `${i.menuId}:${i.quantity}`)
    .sort()
    .join("|");
  const timestamp = Math.floor(Date.now() / 1000); // 1초 단위
  const random = crypto.randomUUID().slice(0, 8);
  return `pos_${simpleHash(payload)}_${timestamp}_${random}`;
}

/** 간단한 해시 (djb2) */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
```

```typescript
// src/hooks/useIdempotencyKey.ts

import { useRef, useCallback } from "react";
import { generateIdempotencyKey } from "@/utils/idempotency";

/**
 * 결제 플로우 동안 단일 멱등성 키를 유지
 * reset()을 호출하면 새 키 생성 (새 주문 시)
 */
export function useIdempotencyKey(
  items: { menuId: string; quantity: number }[]
) {
  const keyRef = useRef<string | null>(null);

  const getKey = useCallback(() => {
    if (!keyRef.current) {
      keyRef.current = generateIdempotencyKey(items);
    }
    return keyRef.current;
  }, [items]);

  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { getKey, reset };
}
```

### 10.3 백엔드: 멱등성 미들웨어

```python
# backend/app/middleware/idempotency.py

import json
from datetime import datetime, timedelta
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from app.db.client import get_db


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    Idempotency-Key 헤더가 있는 POST/PATCH 요청에 대해
    동일한 키로 재요청이 오면 저장된 응답을 반환한다.
    """

    IDEMPOTENT_METHODS = {"POST", "PATCH"}
    TTL_HOURS = 24

    async def dispatch(self, request: Request, call_next):
        # 멱등성 대상이 아닌 요청은 바로 통과
        if request.method not in self.IDEMPOTENT_METHODS:
            return await call_next(request)

        idem_key = request.headers.get("Idempotency-Key")
        if not idem_key:
            return await call_next(request)

        db = get_db()

        # 1. 기존 레코드 조회
        existing = await db.idempotencyrecord.find_unique(
            where={"idempotencyKey": idem_key}
        )

        if existing:
            # 만료 확인
            if existing.expiresAt < datetime.utcnow():
                await db.idempotencyrecord.delete(
                    where={"id": existing.id}
                )
            else:
                # 저장된 응답 반환
                return Response(
                    content=existing.responseBody,
                    status_code=existing.statusCode,
                    media_type="application/json",
                )

        # 2. 핸들러 실행
        response = await call_next(request)

        # 3. 응답 본문 읽기 및 저장
        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        await db.idempotencyrecord.create(
            data={
                "idempotencyKey": idem_key,
                "httpMethod": request.method,
                "path": str(request.url.path),
                "statusCode": response.status_code,
                "responseBody": body.decode("utf-8"),
                "expiresAt": datetime.utcnow() + timedelta(hours=self.TTL_HOURS),
            }
        )

        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )
```

---

## 11. 엣지 케이스 시나리오

### 11.1 시나리오 매트릭스

| # | 시나리오 | 탐지 방법 | 복구 전략 |
|---|---------|-----------|----------|
| 1 | **브라우저 크래시 (결제 전)** | 앱 재로드 시 WAL에 `ORDER_CREATING` 상태 엔트리 | 서버에 주문 상태 확인 → PENDING이면 재결제 유도 |
| 2 | **브라우저 크래시 (Toss 결제창 중)** | WAL에 `TOSS_POPUP` 상태 + paymentKey 없음 | 서버 주문 상태 확인 → Toss에 결제 승인 여부 확인 |
| 3 | **브라우저 크래시 (confirm 중)** | WAL에 `CONFIRMING` + paymentKey 있음 | `POST /confirm` 재시도 (멱등성 키로 안전) |
| 4 | **네트워크 타임아웃 (주문 생성)** | fetch 에러 catch | 멱등성 키로 재시도 → 동일 주문 반환 |
| 5 | **네트워크 타임아웃 (결제 승인)** | fetch 에러 catch | paymentKey로 confirm 재시도 |
| 6 | **중복 탭 결제** | `BroadcastChannel` 또는 `localStorage` 이벤트 | 두 번째 탭에서 결제 차단 + 경고 표시 |
| 7 | **Toss 웹훅 지연** | 폴링으로 서버 상태 확인 | 클라이언트 폴링이 먼저 상태 반영 |
| 8 | **Toss 웹훅 중복 수신** | `WebhookEvent.paymentKey` + `processed` 플래그 | 이미 처리된 이벤트 스킵 |
| 9 | **서버 재시작 중 요청** | HTTP 503 응답 | 클라이언트 자동 재시도 (React-Query retry) |
| 10 | **금액 불일치** | confirm 시 서버가 amount 검증 | 400 에러 → 결제 취소 + 사용자 알림 |

### 11.2 중복 탭 방지

```typescript
// src/hooks/usePaymentLock.ts

const LOCK_KEY = "toss_sync_pos_payment_lock";

export function usePaymentLock() {
  const acquireLock = (): boolean => {
    const existing = localStorage.getItem(LOCK_KEY);
    if (existing) {
      const lock = JSON.parse(existing);
      // 5분 이내의 잠금이면 다른 탭이 결제 중
      if (Date.now() - lock.timestamp < 5 * 60 * 1000) {
        return false;
      }
    }
    localStorage.setItem(
      LOCK_KEY,
      JSON.stringify({ tabId: crypto.randomUUID(), timestamp: Date.now() })
    );
    return true;
  };

  const releaseLock = (): void => {
    localStorage.removeItem(LOCK_KEY);
  };

  return { acquireLock, releaseLock };
}
```

### 11.3 웹훅 중복 처리 (서버)

```python
# backend/app/routers/webhooks.py

import json
import hmac
import hashlib
from fastapi import APIRouter, Request, HTTPException
from app.db.client import get_db
from app.config import settings

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@router.post("/toss")
async def handle_toss_webhook(request: Request):
    body = await request.body()

    # 1. 서명 검증
    signature = request.headers.get("Toss-Signature")
    if not _verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = json.loads(body)
    payment_key = payload.get("paymentKey", "")
    event_type = payload.get("eventType", "")

    db = get_db()

    # 2. 중복 확인
    existing = await db.webhookevent.find_first(
        where={
            "paymentKey": payment_key,
            "eventType": event_type,
            "processed": True,
        }
    )
    if existing:
        return {"status": "already_processed"}

    # 3. 이벤트 기록
    event = await db.webhookevent.create(
        data={
            "eventType": event_type,
            "paymentKey": payment_key,
            "payload": body.decode("utf-8"),
        }
    )

    # 4. 이벤트 처리
    if event_type == "PAYMENT_STATUS_CHANGED":
        await _handle_payment_status_change(db, payload)

    # 5. 처리 완료 마킹
    await db.webhookevent.update(
        where={"id": event.id},
        data={"processed": True, "processedAt": "now()"},
    )

    return {"status": "ok"}


def _verify_signature(body: bytes, signature: str | None) -> bool:
    if not signature:
        return False
    expected = hmac.new(
        settings.TOSS_WEBHOOK_SECRET.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _handle_payment_status_change(db, payload: dict):
    payment_key = payload["paymentKey"]
    status = payload["status"]

    payment = await db.payment.find_unique(
        where={"paymentKey": payment_key}
    )
    if not payment:
        return

    await db.payment.update(
        where={"id": payment.id},
        data={"status": status},
    )

    # 결제 완료 시 주문 상태도 업데이트
    status_map = {
        "DONE": "PAID",
        "CANCELED": "CANCELLED",
        "ABORTED": "FAILED",
    }
    if status in status_map:
        await db.order.update(
            where={"id": payment.orderId},
            data={"status": status_map[status]},
        )
```

---

## 12. 3일 단계별 구현 가이드

### Day 1: 기반 구축 + 주문 흐름

**목표:** 프로젝트 세팅 → 메뉴 조회 → 장바구니 → 주문 생성까지

#### 오전 (환경 세팅)
- [ ] 모노레포 디렉토리 구조 생성
- [ ] 백엔드: FastAPI + Prisma 초기 세팅
  - `pyproject.toml`, `requirements.txt`
  - `prisma/schema.prisma` (전체 스키마)
  - `prisma db push` → SQLite DB 생성
  - `app/main.py` FastAPI 앱 생성 + CORS 설정
  - `app/db/client.py` Prisma 클라이언트 초기화
- [ ] 프론트엔드: Next.js 14 + TypeScript + Emotion 세팅
  - `npx create-next-app@latest` (App Router)
  - `@emotion/react`, `@emotion/styled` 설치
  - `@tanstack/react-query` 설치
  - `src/styles/theme.ts` 테마 정의
  - `src/providers/` Provider 계층 구현

#### 오후 (메뉴 + 장바구니 + 주문)
- [ ] 백엔드: 메뉴 API
  - `GET /api/menus` — 메뉴 목록 조회
  - 시드 데이터 스크립트 (5~10개 메뉴)
- [ ] 백엔드: 주문 API
  - `POST /api/orders` — 주문 생성
  - `GET /api/orders` — 주문 목록
  - `GET /api/orders/{id}` — 주문 상세
- [ ] 프론트엔드: POS 메인 화면
  - `MenuGrid` + `MenuItem` 컴포넌트
  - `CartProvider` + `useCart` 훅
  - `Cart` + `CartItem` + `OrderSummary` 컴포넌트
  - `useOrders` + `useCreateOrder` 훅 (React-Query)
- [ ] 통합 테스트: 메뉴 선택 → 장바구니 추가 → 주문 생성

---

### Day 2: 결제 통합 + 멱등성 + 에러 복구

**목표:** Toss 결제 연동 → 멱등성 미들웨어 → WAL + 자동 복구

#### 오전 (결제 연동)
- [ ] Toss Payments 테스트 키 발급 및 환경변수 설정
- [ ] 프론트엔드: 결제 추상화 레이어
  - `PaymentService` 인터페이스
  - `TossPaymentStrategy` 구현
  - `MockPaymentStrategy` 구현
  - `createPaymentService()` 팩토리
- [ ] 백엔드: 결제 API
  - `POST /api/payments/confirm` — Toss confirm API 호출
  - `GET /api/payments/{orderId}` — 결제 상태 조회
  - `app/services/toss_client.py` — Toss HTTP 클라이언트
- [ ] 프론트엔드: 결제 페이지
  - `/payment` — 결제 진행 화면
  - `/payment/success` — 성공 콜백 처리
  - `/payment/fail` — 실패 콜백 처리

#### 오후 (멱등성 + 에러 복구)
- [ ] 백엔드: 멱등성 미들웨어
  - `IdempotencyMiddleware` 구현
  - `main.py`에 미들웨어 등록
- [ ] 프론트엔드: 멱등성 키 관리
  - `generateIdempotencyKey()` 유틸
  - `useIdempotencyKey()` 훅
- [ ] 프론트엔드: WAL + 복구
  - `WALManager` 구현
  - `RecoveryService` 구현
  - `useRecovery()` 훅
  - `RecoveryBanner` 컴포넌트
  - 결제 상태 머신 (`paymentReducer`)
- [ ] 백엔드: 웹훅 핸들러
  - `POST /api/webhooks/toss`
  - 서명 검증 + 중복 처리
- [ ] 테스트: Mock 결제 → 주문 생성 → 결제 승인 → 상태 확인

---

### Day 3: 관리자 대시보드 + 테마 + 테스트 + 마무리

**목표:** 관리자 화면 → 테마 전환 → 엣지 케이스 처리 → 전체 테스트

#### 오전 (관리자 + 테마)
- [ ] 프론트엔드: 관리자 대시보드
  - `/admin` 페이지
  - `OrderList` — 주문 목록 (필터: 전체/진행중/완료/취소)
  - `OrderDetail` — 주문 상세 (결제 상태 포함)
  - `SalesChart` — 간단한 매출 차트 (선택사항)
- [ ] 프론트엔드: 테마 시스템
  - `ThemeProvider` (light/dark 전환)
  - `ThemeToggle` 컴포넌트
  - 전체 컴포넌트에 테마 적용
  - `localStorage` 테마 영속화
- [ ] 프론트엔드: 중복 탭 방지
  - `usePaymentLock()` 훅

#### 오후 (엣지 케이스 + 테스트 + 마무리)
- [ ] 엣지 케이스 테스트
  - 네트워크 오프라인 시 결제 시도 → 에러 메시지
  - 브라우저 새로고침 → WAL 복구 배너 확인
  - 같은 멱등성 키 재전송 → 동일 응답 확인
  - 중복 탭 결제 차단 확인
- [ ] 백엔드 테스트 (Pytest)
  - 주문 CRUD 테스트
  - 결제 confirm 테스트 (Toss mock)
  - 멱등성 미들웨어 테스트
  - 웹훅 핸들러 테스트
- [ ] 프론트엔드 테스트 (Vitest)
  - `paymentReducer` 상태 전이 테스트
  - `WALManager` 로직 테스트
  - `RecoveryService` 복구 시나리오 테스트
  - `useCart` 훅 테스트
- [ ] 코드 정리 + 에러 핸들링 보강
- [ ] (선택) `docker-compose.yml` 작성

---

## 부록: 환경변수 목록

```bash
# backend/.env
DATABASE_URL="file:./dev.db"
TOSS_SECRET_KEY="test_sk_xxxxxxxxxxxx"
TOSS_WEBHOOK_SECRET="whsec_xxxxxxxxxxxx"
CORS_ORIGINS="http://localhost:3000"

# frontend/.env.local
NEXT_PUBLIC_API_URL="http://localhost:8000"
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_xxxxxxxxxxxx"
NEXT_PUBLIC_PAYMENT_MOCK="false"       # true로 설정 시 Mock 결제
```
