# KioskStep & TableInfo 타입 학습 가이드

> `frontend/src/types/kiosk.ts`에 정의된 타입들이 실제 UI에서 어떤 역할을 하는지 예제와 함께 정리한다.

---

## 1. 전체 코드

```typescript
// frontend/src/types/kiosk.ts

/** 키오스크 주문 단계 */
export type KioskStep = "MENU_SELECT" | "CART_REVIEW" | "ORDER_CONFIRM";
// "MENU_SELECT"   : 메뉴 선택 단계
// "CART_REVIEW"   : 장바구니 확인 단계
// "ORDER_CONFIRM" : 주문 확인 단계

/** 테이블 정보 */
export interface TableInfo {
  tableId: string;
  tableName: string; // "테이블 1", "테이블 2" 등
  capacity?: number;
}
```

---

## 2. KioskStep — 키오스크 화면 전환 상태

### 왜 필요한가?

POS는 **직원**이 사용한다. 메뉴 목록과 장바구니가 한 화면에 나란히 보여도 문제없다.

```
POS (직원용) — 한 화면에 전부 보임
┌──────────────────────────┬──────────────────┐
│  메뉴 목록                │  장바구니         │
│  아메리카노 [+]           │  아메리카노 x2   │
│  카페라떼   [+]           │  합계: 9,000원   │
│                          │  [결제하기]       │
└──────────────────────────┴──────────────────┘
```

키오스크는 **고객**이 사용한다. 메뉴, 장바구니, 확인을 한 화면에 다 넣으면 복잡해진다.
그래서 **단계별로 하나씩** 보여준다:

```
키오스크 (고객용) — 한 번에 하나의 단계만

Step 1: MENU_SELECT          Step 2: CART_REVIEW          Step 3: ORDER_CONFIRM
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ 무엇을 주문하시겠어요? │     │  주문 내역 확인       │     │  주문을 확정할까요?   │
│                     │     │                     │     │                     │
│ ┌─────┐ ┌─────┐    │     │  아메리카노 x2       │     │  아메리카노 x2       │
│ │아메  │ │카페  │    │     │         9,000원     │     │  카페라떼   x1       │
│ │리카노│ │라떼  │    │     │  카페라떼   x1       │     │                     │
│ │4,500 │ │5,000│    │     │         5,000원     │     │  총 14,000원         │
│ └─────┘ └─────┘    │     │                     │     │                     │
│                     │     │  총 14,000원         │     │ [취소]    [확정]     │
│ ┌──────────────────┐│     │                     │     └─────────────────────┘
│ │장바구니 2개 9,000원││     │ [← 더 담기] [주문] │
│ └──────────────────┘│     └─────────────────────┘
└─────────────────────┘
```

### 실제 사용 코드

```typescript
// components/kiosk/KioskShell.tsx
"use client";

import { useState } from "react";
import type { KioskStep } from "@/types/kiosk";
import type { MenuItem } from "@/types/menu";

interface KioskShellProps {
  menus: MenuItem[];   // 서버에서 받은 메뉴 데이터
}

export function KioskShell({ menus }: KioskShellProps) {
  // ✅ KioskStep 타입으로 현재 단계를 관리
  const [step, setStep] = useState<KioskStep>("MENU_SELECT");

  return (
    <>
      {/* Step 1: 메뉴 선택 */}
      {step === "MENU_SELECT" && (
        <MenuSelectView
          menus={menus}
          onNext={() => setStep("CART_REVIEW")}
          //                    ↑ "장바구니 보기" 버튼 클릭 시
        />
      )}

      {/* Step 2: 장바구니 확인 */}
      {step === "CART_REVIEW" && (
        <CartReviewView
          onBack={() => setStep("MENU_SELECT")}
          //                    ↑ "← 더 담기" 버튼 클릭 시
          onNext={() => setStep("ORDER_CONFIRM")}
          //                    ↑ "주문하기" 버튼 클릭 시
        />
      )}

      {/* Step 3: 주문 확정 */}
      {step === "ORDER_CONFIRM" && (
        <OrderConfirmView
          onBack={() => setStep("CART_REVIEW")}
          //                    ↑ "취소" 버튼 클릭 시
          onConfirm={handlePayment}
          //          ↑ "확정" 버튼 → 결제 진입 (Phase 7)
        />
      )}
    </>
  );
}
```

### 상태 전이 흐름

```
                "장바구니 보기"           "주문하기"
MENU_SELECT  ──────────────→  CART_REVIEW  ──────────→  ORDER_CONFIRM
                ←──────────                ←──────────
                 "← 더 담기"                  "취소"
                                                          │
                                                          │ "확정"
                                                          ▼
                                                      결제 진입
                                                     (Phase 7)
```

### 왜 string 리터럴 타입인가?

```typescript
// ❌ 이렇게 하면 오타를 잡을 수 없다
const [step, setStep] = useState<string>("MENU_SELECT");
setStep("MANU_SELECT"); // 오타인데 에러 안 남!

// ✅ KioskStep 타입을 쓰면 정해진 3개 값만 허용
const [step, setStep] = useState<KioskStep>("MENU_SELECT");
setStep("MANU_SELECT"); // 컴파일 에러! "MENU_SELECT" | "CART_REVIEW" | "ORDER_CONFIRM" 만 가능
```

---

## 3. TableInfo — 테이블오더에서 "어느 테이블인지" 식별

### 왜 필요한가?

테이블오더는 손님이 **테이블에 부착된 QR코드**를 스캔해서 주문하는 방식이다.

```
[실제 매장 시나리오]

1. 매장에 테이블 5개, 각 테이블에 QR코드 부착
   ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
   │  T1  │  │  T2  │  │  T3  │  │  T4  │  │  T5  │
   │ [QR] │  │ [QR] │  │ [QR] │  │ [QR] │  │ [QR] │
   └──────┘  └──────┘  └──────┘  └──────┘  └──────┘

2. 테이블 3의 손님이 QR 스캔
   → 브라우저: https://pos.example.com/order/3
                                            ↑ tableId

3. 주문 완료 시 주방 KDS에 표시:
   ┌─────────────────────────┐
   │ #025  [테이블 3]         │  ← tableName 표시
   │ 아메리카노 x2            │
   │ 카페라떼   x1            │
   │ [준비 시작]              │
   └─────────────────────────┘

4. 직원이 "테이블 3"을 보고 해당 테이블로 서빙
```

### 데이터 흐름

```
QR 스캔 → URL /order/3
              │
              ▼
        page.tsx (Server Component)
        params.tableId = "3"
              │
              │  TableInfo 객체 생성
              ▼
        ┌─────────────────────┐
        │ tableId:   "3"      │
        │ tableName: "테이블 3"│
        │ capacity:  4        │  ← 선택사항 (4인석)
        └─────────────────────┘
              │
              │  props로 전달
              ▼
        TableOrderShell (Client Component)
              │
              ├──→ 화면에 "테이블 3" 표시
              │
              └──→ 주문 생성 시 tableId: "3" 서버에 전송
                         │
                         ▼
                   주방 KDS에서 "[테이블 3]" 뱃지로 표시
```

### 실제 사용 코드

**서버 컴포넌트 (page.tsx):**

```typescript
// app/order/[tableId]/page.tsx (Server Component)
import { getMenus } from "@/lib/server-api";
import { TableOrderShell } from "@/components/order/TableOrderShell";
import type { TableInfo } from "@/types/kiosk";

interface PageProps {
  params: { tableId: string };
  // URL이 /order/3 이면 → params.tableId = "3"
  // URL이 /order/7 이면 → params.tableId = "7"
}

export default async function TableOrderPage({ params }: PageProps) {
  const menus = await getMenus();

  // URL 파라미터로 TableInfo 생성
  const tableInfo: TableInfo = {
    tableId: params.tableId,                // "3"
    tableName: `테이블 ${params.tableId}`,   // "테이블 3"
  };

  // 서버에서 fetch한 데이터를 Client Component에 전달
  return <TableOrderShell menus={menus} tableInfo={tableInfo} />;
}
```

**클라이언트 컴포넌트 (Shell):**

```typescript
// components/order/TableOrderShell.tsx
"use client";

import type { MenuItem } from "@/types/menu";
import type { TableInfo } from "@/types/kiosk";

interface Props {
  menus: MenuItem[];
  tableInfo: TableInfo;
}

export function TableOrderShell({ menus, tableInfo }: Props) {
  const { cart, addItem } = useCart();

  const handleOrder = async () => {
    await createOrder({
      items: cart.items,
      tableId: tableInfo.tableId,   // "3" → 서버에 전송
      orderMode: "DINE_IN",         // 테이블오더는 항상 매장식사
    });
  };

  return (
    <div>
      {/* 상단에 테이블 번호 표시 */}
      <header>
        🍽️ {tableInfo.tableName}의 주문
        {/*    "테이블 3의 주문"          */}
      </header>

      {/* 메뉴 목록 */}
      {menus.map((menu) => (
        <MenuCard key={menu.id} menu={menu} onAdd={() => addItem(menu)} />
      ))}

      {/* 주문 버튼 */}
      <button onClick={handleOrder}>주문하기</button>
    </div>
  );
}
```

### TableInfo 각 필드의 역할

```typescript
interface TableInfo {
  tableId: string;      // 서버에 전송 — 어느 테이블의 주문인지 식별
  tableName: string;    // 화면에 표시 — 고객이 자기 테이블 맞는지 확인
  capacity?: number;    // 선택사항 — "4인석" 같은 추가 정보 (확장용)
}
```

| 필드 | 용도 | 누가 사용하나 |
|------|------|-------------|
| `tableId` | 주문 생성 API에 포함 → DB 저장 | 백엔드, KDS |
| `tableName` | 고객 화면 + KDS 뱃지에 표시 | 고객, 직원 |
| `capacity` | 향후 인원수 제한 등 확장용 | 아직 미사용 |

---

## 4. POS vs 키오스크 vs 테이블오더 비교

이 타입들이 왜 필요한지 이해하려면, 세 제품의 **사용자와 UI 방식 차이**를 알아야 한다:

| 항목 | POS (`/`) | 키오스크 (`/kiosk`) | 테이블오더 (`/order/[tableId]`) |
|------|-----------|-------------------|-------------------------------|
| **사용자** | 직원 | 고객 (매장 내 기기) | 고객 (본인 스마트폰) |
| **화면** | 데스크톱 (넓음) | 태블릿 (중간) | 모바일 (좁음) |
| **UI 방식** | 메뉴+장바구니 동시 표시 | **단계별 전환 (KioskStep)** | 세로 리스트 |
| **테이블 정보** | 불필요 | 불필요 | **필수 (TableInfo)** |
| **주문 모드** | 매장/포장 선택 | 매장/포장 선택 | 항상 매장 (DINE_IN) |
| **kiosk.ts 사용** | X | KioskStep | TableInfo |

---

## 5. 연관 Phase

| 타입 | 정의 시점 | 실제 사용 시점 |
|------|----------|--------------|
| `KioskStep` | Phase 4 (타입 정의) | Phase 5 (`KioskShell` 구현) |
| `TableInfo` | Phase 4 (타입 정의) | Phase 5 (`TableOrderShell` 구현) |

- Phase 4 가이드: `docs/steps/phase-04.md` → Step 4-1에서 타입 정의
- Phase 5 가이드: `docs/steps/phase-05.md` → Step 5-6 (키오스크), Step 5-7 (테이블오더)에서 사용
