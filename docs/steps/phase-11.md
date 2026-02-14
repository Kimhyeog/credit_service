# Phase 11. 관리자 대시보드 고도화 & KDS

> **목표:** 관리자 대시보드(매출 요약 + 주문 목록 + 주문 상세/취소)와 KDS 칸반 보드(접수→준비중→완료)를 구현한다. 주문 출처(POS/키오스크/테이블오더)를 추적하고 뱃지로 표시한다.
>
> **예상 소요:** 240~300분 (백엔드 60분 + 프론트엔드 180~240분)
>
> **선행 조건:** Phase 6 완료 (Payment API), Phase 10 완료 (웹훅)

---

## 왜 이 단계가 필요한가?

Phase 1~10까지 구축한 시스템은 **고객 향** 결제 플로우에 집중되어 있다:

```
고객 플로우 (구현 완료):
  POS/키오스크/테이블오더 → 메뉴 선택 → 결제 → 완료

매장 운영자가 없는 것:
  1. 오늘 매출이 얼마인지 모름
  2. 어떤 주문이 들어왔는지 한눈에 못 봄
  3. 주문을 접수 → 준비 → 완료로 관리할 수 없음
  4. 주문이 POS에서 온 건지 키오스크에서 온 건지 구분 안 됨
  5. 결제 완료된 주문을 취소할 수 없음 (백엔드 API는 있지만 UI가 없음)
```

**이 단계에서 운영자에게 필요한 두 가지 화면을 완성한다:**

```
1. 관리자 대시보드 (/admin)
   → 매출 요약 + 주문 목록 (필터/상세/취소)
   → "오늘 얼마 벌었는지, 어떤 주문이 있는지" 확인

2. KDS — Kitchen Display System (/admin/orders)
   → 칸반 보드 (접수 → 준비중 → 완료)
   → "어떤 주문을 먼저 만들어야 하는지" 관리
```

---

## 현재 상태 분석

### 백엔드에 없는 것

```
Order 모델 현재 필드:
  id, orderNumber, status, totalAmount, idempotencyKey, createdAt, updatedAt

누락된 필드:
  source     — 주문 출처 (POS / KIOSK / TABLE)
  orderMode  — 주문 모드 (DINE_IN / TAKE_OUT) ← 프론트에서 보내지만 백엔드가 무시
  tableId    — 테이블 ID (테이블오더에서만 사용)

누락된 상태:
  현재: PENDING → PAYMENT_PENDING → PAID / CANCELLED / REFUNDED / FAILED
  필요: PAID → PREPARING → COMPLETED  (KDS 흐름)

누락된 API:
  PATCH /api/orders/{id}/status  — KDS에서 상태 전환
```

### 프론트엔드에 없는 것

```
현재 admin 페이지: 텍스트 스텁만 존재
  /admin       → "관리자 대시보드 (Phase 5에서 구현 예정)"
  /admin/orders → "KDS 주문현황 (Phase 5에서 구현 예정)"

현재 admin 컴포넌트: 0개 (components/admin/ 디렉토리 비어있음)

재사용 가능한 훅:
  useOrders(status?)  — 3초 폴링, 상태 필터 지원 ✓
  useOrder(orderId)   — 단건 조회 ✓
```

---

## Order 상태 전이 (확장)

```
기존 (결제 플로우):
  PENDING → PAYMENT_PENDING → PAID
                             → CANCELLED (취소)
                             → FAILED (실패)

추가 (KDS 플로우):
  PAID → PREPARING → COMPLETED

전체:
  PENDING
    → PAYMENT_PENDING
      → PAID
        → PREPARING      ← KDS: "준비 시작" 버튼
          → COMPLETED    ← KDS: "완료" 버튼
        → CANCELLED      ← 관리자: "취소" (결제 취소 포함)
      → FAILED
      → CANCELLED
```

**KDS 상태 전환 규칙:**

| 현재 상태   | 허용되는 전환 | 설명                           |
| ----------- | ------------- | ------------------------------ |
| `PAID`      | → `PREPARING` | 주문 접수 / 준비 시작          |
| `PAID`      | → `CANCELLED` | 주문 취소 (결제 취소 API 연동) |
| `PREPARING` | → `COMPLETED` | 준비 완료                      |
| 그 외       | 불가          | 잘못된 전환 시 400 에러        |

---

## 구현 TODO

### Step 11-1. Prisma 스키마 변경

**파일:** `backend/prisma/schema.prisma` (수정)

Order 모델에 3개 필드 추가:

```prisma
model Order {
  id              String   @id @default(cuid())
  orderNumber     Int      @unique
  status          String   @default("PENDING")
  totalAmount     Int
  idempotencyKey  String   @unique
  source          String   @default("POS")       // ← 추가: POS, KIOSK, TABLE
  orderMode       String   @default("DINE_IN")   // ← 추가: DINE_IN, TAKE_OUT
  tableId         String?                         // ← 추가: 테이블오더 전용
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  items           OrderItem[]
  payment         Payment?
}
```

변경 후 적용:

```bash
cd backend
prisma db push    # SQLite에 스키마 반영 (기존 데이터 유지)
prisma generate   # Prisma Client 재생성
```

**왜 `source`와 `orderMode`가 다른 필드인가?**

```
source   = 주문이 어디서 들어왔는지 (POS / KIOSK / TABLE)
orderMode = 고객이 어떻게 먹을지 (DINE_IN / TAKE_OUT)

예시:
  키오스크에서 포장 주문: source="KIOSK", orderMode="TAKE_OUT"
  POS에서 매장 식사:     source="POS",   orderMode="DINE_IN"
  테이블오더:            source="TABLE",  orderMode="DINE_IN", tableId="3"
```

---

### Step 11-2. Pydantic 스키마 변경

**파일:** `backend/app/models/schemas.py` (수정)

```python
# ─── 요청 스키마 ───

class OrderCreate(BaseModel):
    items: list[OrderItemCreate]
    idempotency_key: str = Field(min_length=16, max_length=64)
    source: str = "POS"          # ← 추가
    order_mode: str = "DINE_IN"  # ← 추가
    table_id: str | None = None  # ← 추가

class OrderStatusUpdate(BaseModel):    # ← 신규
    status: str  # PREPARING, COMPLETED

# ─── 응답 스키마 ───

class OrderResponse(BaseModel):
    id: str
    order_number: int
    status: str
    total_amount: int
    source: str             # ← 추가
    order_mode: str         # ← 추가
    table_id: str | None    # ← 추가
    items: list[dict]
    created_at: datetime

    model_config = {"from_attributes": True}
```

---

### Step 11-3. OrderService 변경

**파일:** `backend/app/services/order_service.py` (수정)

#### create_order에 source/orderMode/tableId 저장

기존 `create_order(items, idempotency_key)` 시그니처에 3개 매개변수 추가:

```python
async def create_order(
    self,
    items: list,
    idempotency_key: str,
    source: str = "POS",
    order_mode: str = "DINE_IN",
    table_id: str | None = None,
):
    # ... 기존 로직 ...

    order = await self.db.order.create(
        data={
            "orderNumber": next_number,
            "totalAmount": total_amount,
            "idempotencyKey": idempotency_key,
            "source": source,          # ← 추가
            "orderMode": order_mode,    # ← 추가
            "tableId": table_id,        # ← 추가
            "items": { "create": order_items_data },
        },
        include={"items": {"include": {"menu": True}}},
    )
    return order
```

#### update_status 메서드 신규

```python
# KDS 상태 전환 허용 규칙
KDS_TRANSITIONS: dict[str, list[str]] = {
    "PAID": ["PREPARING", "CANCELLED"],
    "PREPARING": ["COMPLETED"],
}

async def update_status(self, order_id: str, new_status: str):
    """KDS 상태 전환 — PAID→PREPARING→COMPLETED"""
    order = await self.db.order.find_unique(where={"id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")

    allowed = KDS_TRANSITIONS.get(order.status, [])
    if new_status not in allowed:
        raise HTTPException(
            400,
            f"Cannot transition from {order.status} to {new_status}. "
            f"Allowed: {allowed}"
        )

    updated = await self.db.order.update(
        where={"id": order_id},
        data={"status": new_status},
    )
    return updated
```

---

### Step 11-4. Orders 라우터에 status 변경 엔드포인트 추가

**파일:** `backend/app/routers/orders.py` (수정)

```python
from app.models.schemas import OrderCreate, OrderStatusUpdate

@router.patch("/{order_id}/status")
async def update_order_status(order_id: str, body: OrderStatusUpdate):
    """
    KDS 상태 전환

    PAID → PREPARING → COMPLETED
    """
    db = get_db()
    service = OrderService(db)
    return await service.update_status(order_id, body.status)
```

기존 `create_order` 라우터도 source/order_mode/table_id를 전달하도록 수정:

```python
@router.post("")
async def create_order(body: OrderCreate, ...):
    # ...
    order = await service.create_order(
        items=body.items,
        idempotency_key=body.idempotency_key,
        source=body.source,
        order_mode=body.order_mode,
        table_id=body.table_id,
    )
```

---

### Step 11-5. 프론트엔드 타입 변경

**파일:** `frontend/src/types/order.ts` (수정)

```typescript
export interface OrderCreateRequest {
  items: OrderItemCreate[];
  idempotency_key: string;
  order_mode?: OrderMode;
  source?: "POS" | "KIOSK" | "TABLE"; // ← 추가
  table_id?: string; // ← 추가
}

export interface OrderResponse {
  id: string;
  orderNumber: number;
  status: string;
  totalAmount: number;
  idempotencyKey: string;
  source: string; // ← 추가
  orderMode: string; // ← 추가
  tableId: string | null; // ← 추가
  items: OrderItemResponse[];
  payment: PaymentResponse | null;
  createdAt: string;
  updatedAt: string;
}
```

---

### Step 11-6. 프론트엔드 훅 추가

**파일:** `frontend/src/hooks/useUpdateOrderStatus.ts` (신규)

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      api.patch(`/api/orders/${orderId}/status`, { status }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
```

**파일:** `frontend/src/hooks/useCancelOrder.ts` (신규)

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) =>
      api.post(`/api/payments/${orderId}/cancel`),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
```

---

### Step 11-7. Shell 컴포넌트에 source 추가

각 Shell의 `onOrderCreate` 콜백에서 `source` 필드를 추가한다.

**Cart.tsx (POS):**

```typescript
onOrderCreate: async () => {
  const order = await createOrder.mutateAsync({
    items: ...,
    idempotency_key: idempotencyKey,
    order_mode: state.orderMode,
    source: "POS",              // ← 추가
  });
  dispatch({ type: "CLEAR" });
  return order;
},
```

**KioskShell.tsx:**

```typescript
source: "KIOSK",                // ← 추가
```

**TableOrderShell.tsx:**

```typescript
source: "TABLE",                // ← 추가
table_id: tableId,              // ← 추가
```

---

### Step 11-8. OrderSourceBadge 컴포넌트

**파일:** `frontend/src/components/admin/OrderSourceBadge.tsx` (신규)

```typescript
"use client";

import styled from "@emotion/styled";

const Badge = styled.span<{ color: string }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  background: ${({ color }) => color}20;  /* 배경은 20% 투명도 */
  color: ${({ color }) => color};
`;

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  POS: { label: "POS", color: "#3182F6" },
  KIOSK: { label: "키오스크", color: "#8B5CF6" },
  TABLE: { label: "테이블", color: "#10B981" },
};

export default function OrderSourceBadge({ source }: { source: string }) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.POS;
  return <Badge color={config.color}>{config.label}</Badge>;
}
```

---

### Step 11-9. SalesSummary 컴포넌트

**파일:** `frontend/src/components/admin/SalesSummary.tsx` (신규)

PAID, PREPARING, COMPLETED 상태의 주문에서 클라이언트 계산.

```typescript
"use client";

import styled from "@emotion/styled";
import type { OrderResponse } from "@/types/order";

interface SalesSummaryProps {
  orders: OrderResponse[];
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
`;

const Card = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.md};
  text-align: center;
`;

const CardLabel = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const CardValue = styled.p`
  font-size: ${({ theme }) => theme.fontSize.xxl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const PAID_STATUSES = ["PAID", "PREPARING", "COMPLETED"];

export default function SalesSummary({ orders }: SalesSummaryProps) {
  const paidOrders = orders.filter((o) => PAID_STATUSES.includes(o.status));
  const totalSales = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const count = paidOrders.length;
  const average = count > 0 ? Math.round(totalSales / count) : 0;

  return (
    <Grid>
      <Card>
        <CardLabel>오늘 매출</CardLabel>
        <CardValue>{totalSales.toLocaleString()}원</CardValue>
      </Card>
      <Card>
        <CardLabel>주문 건수</CardLabel>
        <CardValue>{count}건</CardValue>
      </Card>
      <Card>
        <CardLabel>평균 단가</CardLabel>
        <CardValue>{average.toLocaleString()}원</CardValue>
      </Card>
    </Grid>
  );
}
```

**왜 별도 API 대신 클라이언트 계산인가?**

```
API 방식:
  GET /api/orders/summary?date=2026-02-15
  → 서버에서 쿼리 + 집계 → 응답
  → 장점: 대량 데이터에서 효율적
  → 단점: 추가 API 개발 필요, 캐시 관리

클라이언트 계산 방식:
  useOrders()로 이미 주문 목록을 가져옴
  → 메모리에서 filter + reduce
  → 장점: 추가 API 불필요, useOrders의 3초 폴링으로 자동 갱신
  → 단점: 주문이 수천 건이면 느려질 수 있음

소규모 매장 POS에서는 하루 주문이 보통 100~300건
→ 클라이언트 계산으로 충분
```

---

### Step 11-10. OrderList 컴포넌트

**파일:** `frontend/src/components/admin/OrderList.tsx` (신규)

상태 필터 탭 + 주문 목록 테이블.

```typescript
"use client";

import { useState } from "react";
import styled from "@emotion/styled";
import OrderSourceBadge from "./OrderSourceBadge";
import type { OrderResponse } from "@/types/order";

interface OrderListProps {
  orders: OrderResponse[];
  onSelect: (orderId: string) => void;
}

const STATUS_TABS = [
  { key: null, label: "전체" },
  { key: "active", label: "진행중" }, // PAID + PREPARING
  { key: "completed", label: "완료" }, // COMPLETED
  { key: "cancelled", label: "취소" }, // CANCELLED + FAILED
];

const ACTIVE_STATUSES = ["PAID", "PREPARING"];
const COMPLETED_STATUSES = ["COMPLETED"];
const CANCELLED_STATUSES = ["CANCELLED", "FAILED"];
```

**필터 로직:**

```
"전체"   → 모든 주문
"진행중" → status ∈ {PAID, PREPARING}
"완료"   → status ∈ {COMPLETED}
"취소"   → status ∈ {CANCELLED, FAILED}
```

주문 행을 클릭하면 `onSelect(orderId)`를 호출하여 부모(AdminDashboard)에서 OrderDetail을 표시한다.

---

### Step 11-11. OrderDetail 컴포넌트

**파일:** `frontend/src/components/admin/OrderDetail.tsx` (신규)

선택된 주문의 상세 정보를 표시하는 모달/패널.

포함 내용:

- 주문 번호 + 상태 뱃지
- 출처 뱃지 (OrderSourceBadge)
- 주문 항목 테이블 (메뉴명, 수량, 가격)
- 결제 정보 (결제 수단, 승인 시간, paymentKey)
- 주문 시간 (createdAt 포맷팅)
- 취소 버튼 (PAID 상태일 때만, 결제 취소 API 연동)

```typescript
취소 흐름:
  1. "주문 취소" 버튼 클릭
  2. window.confirm("정말 취소하시겠습니까?")
  3. YES → useCancelOrder().mutate(orderId)
  4. 성공 → useOrders 캐시 무효화 → 목록 갱신
```

---

### Step 11-12. KDSBoard 컴포넌트

**파일:** `frontend/src/components/admin/KDSBoard.tsx` (신규)

칸반 스타일 4컬럼 보드.

```typescript
4개 컬럼:
  접수 (PAID)       → "준비 시작" 버튼 → PREPARING
  준비중 (PREPARING) → "완료" 버튼 → COMPLETED
  완료 (COMPLETED)   → 버튼 없음
  취소 (CANCELLED)   → 버튼 없음
```

데이터 소스:

```
useOrders() → 전체 주문 목록 (3초 폴링)
  → status별로 분류:
    received  = orders.filter(o => o.status === "PAID")
    preparing = orders.filter(o => o.status === "PREPARING")
    completed = orders.filter(o => o.status === "COMPLETED")
    cancelled = orders.filter(o => ["CANCELLED", "FAILED"].includes(o.status))
```

상태 전환:

```
"준비 시작" 클릭 → useUpdateOrderStatus().mutate({ orderId, status: "PREPARING" })
"완료" 클릭     → useUpdateOrderStatus().mutate({ orderId, status: "COMPLETED" })
→ onSuccess에서 orders 캐시 무효화 → 3초 안에 다음 폴링에서 반영
```

**칸반 카드 정보:**

```
┌─────────────┐
│ #023        │  ← orderNumber
│ 아메 x2     │  ← 주문 항목 요약
│ 바닐라 x1   │
│ [POS] 10:30 │  ← 출처 뱃지 + 주문 시간
│ [준비 시작]  │  ← 상태 전환 버튼
└─────────────┘
```

---

### Step 11-13. Admin 페이지 교체

**파일:** `frontend/src/app/admin/page.tsx` (수정)

현재 텍스트 스텁을 Server Page → Client Shell 패턴으로 교체.

```typescript
// Server Page — 데이터 없이 바로 클라이언트 Shell 렌더링
// (useOrders 훅이 클라이언트에서 폴링하므로 서버 fetch 불필요)
import AdminDashboardShell from "@/components/admin/AdminDashboardShell";

export default function AdminPage() {
  return <AdminDashboardShell />;
}
```

**파일:** `frontend/src/components/admin/AdminDashboardShell.tsx` (신규)

```
"use client";

조합:
  TopBar (Toss-Sync 주문 관리 + 네비게이션)
  SalesSummary (매출 카드 3개)
  OrderList (필터 탭 + 목록)
  OrderDetail (선택된 주문 모달/사이드패널)

상태:
  const { data: orders } = useOrders();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
```

**파일:** `frontend/src/app/admin/orders/page.tsx` (수정)

```typescript
import KDSPageShell from "@/components/admin/KDSPageShell";

export default function KDSPage() {
  return <KDSPageShell />;
}
```

**파일:** `frontend/src/components/admin/KDSPageShell.tsx` (신규)

```
"use client";

조합:
  TopBar (Toss-Sync 주문현황 KDS + 네비게이션)
  KDSBoard (칸반 보드)

상태:
  const { data: orders } = useOrders();
  → KDSBoard에 orders 전달
```

---

## 구현할 파일 정리

### 백엔드 (4개)

| #   | 파일                                    | 유형 | 설명                                                          |
| --- | --------------------------------------- | ---- | ------------------------------------------------------------- |
| 1   | `backend/prisma/schema.prisma`          | 수정 | Order에 source, orderMode, tableId 추가                       |
| 2   | `backend/app/models/schemas.py`         | 수정 | OrderCreate/OrderResponse에 필드 추가, OrderStatusUpdate 신규 |
| 3   | `backend/app/services/order_service.py` | 수정 | create_order에 source 등 저장, update_status 메서드 추가      |
| 4   | `backend/app/routers/orders.py`         | 수정 | PATCH /{id}/status 엔드포인트 추가, create에 source 전달      |

### 프론트엔드 — 타입/훅 (4개)

| #    | 파일                                          | 유형 | 설명                                              |
| ---- | --------------------------------------------- | ---- | ------------------------------------------------- |
| 5    | `frontend/src/types/order.ts`                 | 수정 | OrderCreateRequest/OrderResponse에 source 등 추가 |
| 6    | `frontend/src/hooks/useUpdateOrderStatus.ts`  | 신규 | PATCH /api/orders/{id}/status 뮤테이션            |
| 7    | `frontend/src/hooks/useCancelOrder.ts`        | 신규 | POST /api/payments/{orderId}/cancel 뮤테이션      |
| 8~10 | Cart.tsx, KioskShell.tsx, TableOrderShell.tsx | 수정 | onOrderCreate에 source 필드 추가                  |

### 프론트엔드 — 컴포넌트 (7개)

| #   | 파일                                       | 유형 | 설명                     |
| --- | ------------------------------------------ | ---- | ------------------------ |
| 11  | `components/admin/OrderSourceBadge.tsx`    | 신규 | POS/키오스크/테이블 뱃지 |
| 12  | `components/admin/SalesSummary.tsx`        | 신규 | 매출 요약 카드 3개       |
| 13  | `components/admin/OrderList.tsx`           | 신규 | 상태 필터 탭 + 주문 행   |
| 14  | `components/admin/OrderDetail.tsx`         | 신규 | 주문 상세 + 취소 버튼    |
| 15  | `components/admin/KDSBoard.tsx`            | 신규 | 칸반 4컬럼 + 상태 전환   |
| 16  | `components/admin/AdminDashboardShell.tsx` | 신규 | 대시보드 Shell (조합)    |
| 17  | `components/admin/KDSPageShell.tsx`        | 신규 | KDS Shell (조합)         |

### 프론트엔드 — 페이지 (2개)

| #   | 파일                        | 유형 | 설명                       |
| --- | --------------------------- | ---- | -------------------------- |
| 18  | `app/admin/page.tsx`        | 수정 | 스텁 → AdminDashboardShell |
| 19  | `app/admin/orders/page.tsx` | 수정 | 스텁 → KDSPageShell        |

**합계: 19개 파일** (신규 9개 + 수정 10개)

---

## 구현 순서

1. **백엔드 스키마 + API** (Step 11-1 ~ 11-4)
   - Prisma 스키마 → db push → generate
   - Pydantic 스키마 → 서비스 → 라우터
   - curl로 status 변경 API 테스트

2. **프론트엔드 타입 + 훅** (Step 11-5 ~ 11-7)
   - types/order.ts 변경
   - useUpdateOrderStatus, useCancelOrder 훅
   - Shell 컴포넌트에 source 추가

3. **프론트엔드 컴포넌트** (Step 11-8 ~ 11-12)
   - OrderSourceBadge (의존성 없음)
   - SalesSummary (orders 데이터만 필요)
   - OrderList (orders + onSelect)
   - OrderDetail (useOrder + useCancelOrder)
   - KDSBoard (useOrders + useUpdateOrderStatus)

4. **페이지 조합 + Shell** (Step 11-13)
   - AdminDashboardShell = SalesSummary + OrderList + OrderDetail
   - KDSPageShell = KDSBoard
   - 페이지 스텁 교체

5. **빌드 검증**

```bash
cd backend && python -c "from app.routers.orders import router; print('OK')"
cd frontend && npm run build
```

---

## 검증 체크리스트

### 백엔드 API

```bash
# 1. source가 저장되는지 확인
curl -s http://localhost:8000/api/orders | python -m json.tool
# → 각 주문에 source, orderMode, tableId 필드가 있어야 함

# 2. KDS 상태 전환
curl -X PATCH http://localhost:8000/api/orders/<order_id>/status \
  -H "Content-Type: application/json" \
  -d '{"status": "PREPARING"}'
# → 성공 (PAID → PREPARING)

curl -X PATCH http://localhost:8000/api/orders/<order_id>/status \
  -H "Content-Type: application/json" \
  -d '{"status": "COMPLETED"}'
# → 성공 (PREPARING → COMPLETED)

# 3. 잘못된 전환 차단
curl -X PATCH http://localhost:8000/api/orders/<order_id>/status \
  -H "Content-Type: application/json" \
  -d '{"status": "PAID"}'
# → 400 에러 (COMPLETED → PAID 불가)
```

### 프론트엔드

```
1. POS에서 주문 → /admin에서 [POS] 뱃지 확인
2. 키오스크에서 주문 → /admin에서 [키오스크] 뱃지 확인
3. /admin → 매출 요약 카드 3개 정상 표시
4. /admin → 상태 필터 탭 전환 → 해당 주문만 표시
5. /admin → 주문 행 클릭 → 상세 모달 (항목, 결제, 취소 버튼)
6. /admin → PAID 주문 취소 → 결제 취소 + 상태 변경
7. /admin/orders (KDS) → 4컬럼 칸반 보드
8. KDS → "준비 시작" → PAID→PREPARING 이동
9. KDS → "완료" → PREPARING→COMPLETED 이동
10. 새 주문 들어오면 3초 내 KDS에 자동 반영
```

### 빌드

```bash
cd frontend && npm run build    # 타입 + 빌드 에러 없음
```

---

## 다음 단계

→ **Phase 12**: 중복 탭 방지 & 엣지 케이스 처리. 동시 결제 방지(usePaymentLock), 글로벌 에러 핸들러, 네트워크 오프라인 처리를 구현한다.
