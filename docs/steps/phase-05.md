# Phase 5. 프론트엔드 — POS 메인 화면 + 키오스크 + 테이블오더

> **목표:** 토스 POS 스타일의 메인 화면(카테고리 탭 + 메뉴 그리드 + 장바구니 + 매장/포장 토글), 키오스크 기본 구조, 테이블오더 기본 구조, Server Page → Client Shell 패턴 적용
>
> **예상 소요:** 120~150분
>
> **선행 조건:** Phase 4 완료 (Provider 계층, 테마, API 클라이언트, 타입 정의, 라우트 구조)

---

## 왜 이 단계가 필요한가?

POS 시스템의 **핵심 사용 흐름**은 "메뉴를 보고 → 장바구니에 담고 → 주문을 생성하는 것"이다. 이 화면이 동작해야 Phase 3에서 만든 백엔드 API와 Phase 4에서 만든 프론트엔드 인프라가 **실제로 연결되는지** 확인할 수 있다.

이 단계에서는 토스플레이스의 세 가지 제품을 시뮬레이션한다:

| 제품 | 페이지 | 사용자 | 핵심 특징 |
|------|--------|--------|----------|
| **POS** | `/` | 매장 직원 | 카테고리 탭, 즐겨찾기, 매장/포장 토글, 빠른 조작 |
| **키오스크** | `/kiosk` | 고객 (셀프) | 큰 메뉴 카드, 간소화된 플로우, 터치 최적화 |
| **테이블오더** | `/order/[tableId]` | 고객 (모바일) | 테이블 번호 기반, 모바일 레이아웃 |

같은 메뉴 데이터, 같은 주문 API를 쓰되 **UI와 사용 맥락이 다르다**. 이것이 컴포넌트 기반 아키텍처의 강점 — 공통 로직(React-Query 훅, CartProvider)은 재사용하고, 표현 계층만 분리한다.

**POS 메인 화면 (직원용) 목표:**
```
┌─────────────────────────────────────────────────────────┐
│  [Toss-Sync POS]        [키오스크 전환] [KDS] [🌙]     │ ← TopBar
├─────────────────────────────────────────────────────────┤
│  [★ 즐겨찾기] [커피] [음료] [베이커리]                   │ ← CategoryTabs
├──────────────────────────────┬──────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ │  장바구니                 │
│  │ 아메  │ │ 카페  │ │ 바닐  │ │                          │
│  │리카노 │ │ 라떼  │ │라라떼 │ │  아메리카노 x2    9,000  │
│  │4,500원│ │5,000원│ │5,500원│ │  카페라떼   x1    5,000  │
│  └──────┘ └──────┘ └──────┘ │                          │
│  ┌──────┐ ┌──────┐ ┌──────┐ │  ────────────────────── │
│  │      │ │      │ │      │ │  [매장]  [포장]          │
│  │      │ │      │ │      │ │  총 3개      14,000원    │
│  └──────┘ └──────┘ └──────┘ │  [     결제하기     ]    │
└──────────────────────────────┴──────────────────────────┘
```

**키오스크 화면 (고객용) 목표:**
```
┌─────────────────────────────────────┐
│        무엇을 주문하시겠어요?        │
├─────────────────────────────────────┤
│  [커피] [음료] [베이커리]            │
├─────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐      │
│  │   [img]   │  │   [img]   │      │
│  │ 아메리카노 │  │  카페라떼  │      │
│  │  4,500원   │  │  5,000원   │      │
│  └───────────┘  └───────────┘      │
├─────────────────────────────────────┤
│  장바구니 2개              9,000원   │
│  [         주문하기          ]       │
└─────────────────────────────────────┘
```

---

## 구현 TODO

### Step 5-1. React-Query 훅

백엔드 API를 호출하는 커스텀 훅을 만든다. 컴포넌트에서 직접 `api.get()`을 부르지 않고 훅을 통하는 이유:

- 캐시 키, 폴링 간격, 에러 재시도 등 설정을 한 곳에서 관리
- 여러 컴포넌트에서 같은 쿼리를 부르면 React-Query가 **자동으로 중복 제거** (네트워크 요청 1회)
- 컴포넌트는 `data`, `isLoading`, `isError`만 알면 되므로 관심사가 분리됨

#### 5-1-1. useMenus

**파일:** `frontend/src/hooks/useMenus.ts`

```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { MenuItem } from "@/types/menu";

/**
 * 메뉴 목록 조회
 * - Server Component에서 initialData를 전달받으면 즉시 렌더링
 * - 이후 staleTime(5초) 경과 시 백그라운드 리페치
 */
export function useMenus(initialData?: MenuItem[]) {
  return useQuery<MenuItem[]>({
    queryKey: ["menus"],
    queryFn: () => api.get<MenuItem[]>("/api/menus"),
    initialData,
  });
}
```

**`initialData` 파라미터가 추가된 이유:**

Phase 4의 "Server Page → Client Shell" 패턴에서, 서버에서 가져온 메뉴 데이터를 React-Query에 주입한다:

```
1. Server Component (page.tsx)에서 getMenus() 호출 → 메뉴 8개
2. props로 Client Shell에 전달
3. Client Shell에서 useMenus(initialMenus) 호출
4. React-Query는 initialData로 즉시 캐시에 저장 → 로딩 스피너 없음
5. staleTime(5초) 후 백그라운드 리페치 → 최신 데이터로 교체
```

#### 5-1-2. useOrders

**파일:** `frontend/src/hooks/useOrders.ts`

```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { OrderResponse } from "@/types/order";

/** 주문 목록 — 3초 간격 폴링 */
export function useOrders(status?: string) {
  return useQuery<OrderResponse[]>({
    queryKey: ["orders", { status }],
    queryFn: () => api.get<OrderResponse[]>("/api/orders", { params: { status } }),
    refetchInterval: 3_000,               // 3초마다 자동 리페치
    refetchIntervalInBackground: true,    // 탭이 백그라운드여도 폴링 유지
  });
}

/** 주문 상세 */
export function useOrder(orderId: string) {
  return useQuery<OrderResponse>({
    queryKey: ["orders", orderId],
    queryFn: () => api.get<OrderResponse>(`/api/orders/${orderId}`),
    enabled: !!orderId,     // orderId가 있을 때만 실행
  });
}
```

**왜 3초 폴링인가?**

```
POS 화면에서 주문 상태가 실시간으로 바뀌어야 하는 시나리오:
1. 고객이 결제를 완료 → 주문 상태가 PENDING → PAID로 변경
2. POS 화면에서 이 변경이 즉시 반영되어야 직원이 주문 처리 가능

WebSocket 대신 폴링을 쓰는 이유:
- 구현이 훨씬 단순 (별도 WS 서버 불필요)
- 3초면 POS 환경에서 충분히 빠름
- React-Query가 자동으로 처리해주므로 코드도 간결
```

#### 5-1-3. useCreateOrder

**파일:** `frontend/src/hooks/useCreateOrder.ts`

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { OrderResponse, OrderCreateRequest } from "@/types/order";

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation<
    OrderResponse,
    Error,
    OrderCreateRequest,
    { previous: OrderResponse[] | undefined }
  >({
    mutationFn: (body) =>
      api.post<OrderResponse>("/api/orders", body, {
        headers: { "Idempotency-Key": body.idempotency_key },
      }),

    // 낙관적 업데이트: 서버 응답 전에 UI에 주문 추가
    onMutate: async (newOrder) => {
      // 진행 중인 orders 쿼리 취소 (낙관적 데이터와 충돌 방지)
      await queryClient.cancelQueries({ queryKey: ["orders"] });

      // 현재 캐시 스냅샷 (롤백용)
      const previous = queryClient.getQueryData<OrderResponse[]>(["orders"]);

      return { previous };
    },

    // 성공: 서버 데이터로 교체
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

**낙관적 업데이트 흐름:**

```
1. 사용자가 "주문하기" 클릭
2. onMutate: 현재 orders 캐시 스냅샷 저장 (previous)
3. mutationFn: POST /api/orders 서버 호출 (비동기)
4. 성공 → onSuccess: orders 캐시 무효화 → 서버 최신 데이터로 교체
5. 실패 → onError: previous로 롤백 → UI가 원래 상태로 복구
```

---

### Step 5-2. 공통 UI 컴포넌트

POS 화면을 만들기 전에, 여러 곳에서 반복 사용할 공통 컴포넌트를 먼저 만든다.

#### 5-2-1. Button

**파일:** `frontend/src/components/common/Button.tsx`

```typescript
"use client";

import styled from "@emotion/styled";

interface ButtonProps {
  variant?: "primary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

const StyledButton = styled.button<ButtonProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ size, theme }) =>
    size === "sm"
      ? `${theme.spacing.xs} ${theme.spacing.sm}`
      : size === "lg"
        ? `${theme.spacing.md} ${theme.spacing.lg}`
        : `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: ${({ size, theme }) =>
    size === "sm" ? theme.fontSize.sm : size === "lg" ? theme.fontSize.lg : theme.fontSize.md};
  font-weight: 600;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  width: ${({ fullWidth }) => (fullWidth ? "100%" : "auto")};
  transition: background-color 0.15s, opacity 0.15s;

  ${({ variant, theme }) => {
    switch (variant) {
      case "danger":
        return `
          background: ${theme.colors.danger};
          color: white;
          &:hover { opacity: 0.9; }
        `;
      case "ghost":
        return `
          background: transparent;
          color: ${theme.colors.text.secondary};
          &:hover { background: ${theme.colors.surfaceHover}; }
        `;
      default: // primary
        return `
          background: ${theme.colors.primary};
          color: white;
          &:hover { background: ${theme.colors.primaryHover}; }
        `;
    }
  }}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export default StyledButton;
```

#### 5-2-2. ThemeToggle

**파일:** `frontend/src/components/common/ThemeToggle.tsx`

```typescript
"use client";

import styled from "@emotion/styled";
import { useThemeMode } from "@/providers/ThemeProvider";

const ToggleButton = styled.button`
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  background: ${({ theme }) => theme.colors.surface};
  font-size: ${({ theme }) => theme.fontSize.lg};
  transition: background-color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

export default function ThemeToggle() {
  const { mode, toggle } = useThemeMode();

  return (
    <ToggleButton onClick={toggle} aria-label="테마 전환">
      {mode === "light" ? "🌙" : "☀️"}
    </ToggleButton>
  );
}
```

#### 5-2-3. CategoryTabs — 토스 POS 스타일 카테고리 탭

**파일:** `frontend/src/components/common/CategoryTabs.tsx`

토스 POS에서 메뉴 카테고리를 전환하는 탭 바. 즐겨찾기(★) 탭을 포함한다.

```typescript
"use client";

import styled from "@emotion/styled";

interface CategoryTabsProps {
  categories: string[];
  activeCategory: string | null;   // null = 전체/즐겨찾기
  onSelect: (category: string | null) => void;
  showFavorites?: boolean;         // 즐겨찾기 탭 표시 여부 (POS만)
}

const TabBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;

  /* 스크롤바 숨기기 (탭이 많을 때) */
  &::-webkit-scrollbar {
    display: none;
  }
`;

const Tab = styled.button<{ isActive: boolean }>`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.15s;

  ${({ isActive, theme }) =>
    isActive
      ? `
        background: ${theme.colors.primary};
        color: white;
      `
      : `
        background: ${theme.colors.surface};
        color: ${theme.colors.text.secondary};
        &:hover {
          background: ${theme.colors.surfaceHover};
        }
      `}
`;

export default function CategoryTabs({
  categories,
  activeCategory,
  onSelect,
  showFavorites = false,
}: CategoryTabsProps) {
  return (
    <TabBar>
      {showFavorites && (
        <Tab
          isActive={activeCategory === null}
          onClick={() => onSelect(null)}
        >
          ★ 즐겨찾기
        </Tab>
      )}
      {!showFavorites && (
        <Tab
          isActive={activeCategory === null}
          onClick={() => onSelect(null)}
        >
          전체
        </Tab>
      )}
      {categories.map((cat) => (
        <Tab
          key={cat}
          isActive={activeCategory === cat}
          onClick={() => onSelect(cat)}
        >
          {cat}
        </Tab>
      ))}
    </TabBar>
  );
}
```

**왜 카테고리 탭이 필요한가?**

기존 Phase 5에서는 카테고리별로 섹션을 나누어 **모든 메뉴를 한 화면에 표시**했다. 토스 POS에서는 **탭을 눌러 카테고리를 전환**하는 방식이다:

```
기존: 모든 카테고리 한 번에 표시 (스크롤 많음)
  [커피 섹션]
  아메리카노, 카페라떼, 바닐라라떼
  [음료 섹션]
  녹차라떼, 초코라떼, 딸기스무디
  [베이커리 섹션]
  크로와상, 치즈케이크

토스 POS: 탭으로 카테고리 전환 (한 화면에 한 카테고리)
  [★ 즐겨찾기] [커피✓] [음료] [베이커리]
  아메리카노  카페라떼  바닐라라떼
  (커피 카테고리만 표시)
```

- 메뉴가 많아져도 화면이 복잡해지지 않음
- 직원이 원하는 카테고리에 빠르게 접근 가능
- 키오스크에서도 동일한 탭 패턴 재사용

#### 5-2-4. OrderModeToggle — 매장/포장 토글

**파일:** `frontend/src/components/common/OrderModeToggle.tsx`

```typescript
"use client";

import styled from "@emotion/styled";
import { useCart } from "@/providers/CartProvider";
import type { OrderMode } from "@/types/order";

const ToggleContainer = styled.div`
  display: flex;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const ToggleOption = styled.button<{ isActive: boolean }>`
  flex: 1;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  transition: all 0.15s;

  ${({ isActive, theme }) =>
    isActive
      ? `
        background: ${theme.colors.primary};
        color: white;
      `
      : `
        background: ${theme.colors.background};
        color: ${theme.colors.text.secondary};
        &:hover {
          background: ${theme.colors.surfaceHover};
        }
      `}
`;

export default function OrderModeToggle() {
  const { state, dispatch } = useCart();

  const handleSelect = (mode: OrderMode) => {
    dispatch({ type: "SET_ORDER_MODE", mode });
  };

  return (
    <ToggleContainer>
      <ToggleOption
        isActive={state.orderMode === "DINE_IN"}
        onClick={() => handleSelect("DINE_IN")}
      >
        매장
      </ToggleOption>
      <ToggleOption
        isActive={state.orderMode === "TAKE_OUT"}
        onClick={() => handleSelect("TAKE_OUT")}
      >
        포장
      </ToggleOption>
    </ToggleContainer>
  );
}
```

**왜 매장/포장 토글이 필요한가?**

```
실제 매장 시나리오:
직원: "매장이세요 포장이세요?"
고객: "포장이요"
직원: [포장] 탭 클릭 → 주문 모드가 TAKE_OUT으로 변경

이 정보는:
1. 주문 생성 시 order_mode로 전송 (향후 백엔드 확장)
2. 영수증/주문표에 "매장/포장" 표시
3. KDS(주방 디스플레이)에서 포장 주문은 별도 표시
```

---

### Step 5-3. 메뉴 컴포넌트 — 토스 POS 스타일

#### 5-3-1. MenuItem — 카테고리 색상 코딩 + 큰 터치 영역

**파일:** `frontend/src/components/pos/MenuItem.tsx`

```typescript
"use client";

import styled from "@emotion/styled";
import { useTheme } from "@emotion/react";
import type { MenuItem as MenuItemType } from "@/types/menu";

interface MenuItemProps {
  menu: MenuItemType;
  onClick: (menu: MenuItemType) => void;
}

/** 카테고리에 따른 테마 색상 키 반환 */
function getCategoryColorKey(category: string): "coffee" | "beverage" | "bakery" | "default" {
  const lower = category.toLowerCase();
  if (lower === "커피" || lower === "coffee") return "coffee";
  if (lower === "음료" || lower === "beverage") return "beverage";
  if (lower === "베이커리" || lower === "bakery") return "bakery";
  return "default";
}

const Card = styled.button<{ categoryColor: string }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.md};
  transition: background-color 0.15s, transform 0.1s;
  text-align: center;
  min-height: 120px;
  position: relative;

  /* 카테고리 색상 상단 바 */
  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: ${({ categoryColor }) => categoryColor};
    border-radius: ${({ theme }) => `${theme.borderRadius.md} ${theme.borderRadius.md} 0 0`};
  }

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const MenuName = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const MenuPrice = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const MenuCategory = styled.span<{ categoryColor: string }>`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ categoryColor }) => categoryColor};
  background: ${({ categoryColor }) => `${categoryColor}15`};
  padding: 2px 8px;
  border-radius: 4px;
`;

export default function MenuItem({ menu, onClick }: MenuItemProps) {
  const theme = useTheme();
  const colorKey = getCategoryColorKey(menu.category);
  const categoryColor = theme.colors.category[colorKey];

  return (
    <Card onClick={() => onClick(menu)} categoryColor={categoryColor}>
      <MenuCategory categoryColor={categoryColor}>{menu.category}</MenuCategory>
      <MenuName>{menu.name}</MenuName>
      <MenuPrice>{menu.price.toLocaleString()}원</MenuPrice>
    </Card>
  );
}
```

**기존 대비 변경사항:**

- 카테고리 색상 코딩 추가 (상단 3px 바 + 카테고리 라벨 색상)
- `min-height: 120px` — 터치 영역 확대 (POS는 터치스크린)
- `getCategoryColorKey()` 헬퍼로 카테고리→색상 매핑
- `useTheme()`으로 테마에서 카테고리 색상을 가져옴 — 하드코딩 색상 대신 `theme.colors.category[colorKey]` 사용으로 다크모드 자동 대응

**왜 `<button>`을 쓰나?**

- 메뉴 카드를 클릭하면 장바구니에 추가됨 → 인터랙티브 요소
- `<div onClick>`보다 `<button>`이 **접근성**(키보드 탐색, 스크린 리더)에 좋음
- 기본 button 스타일은 `global.ts`에서 이미 리셋됨

#### 5-3-2. MenuGrid — 카테고리 탭 연동

**파일:** `frontend/src/components/pos/MenuGrid.tsx`

```typescript
"use client";

import { useState, useMemo } from "react";
import styled from "@emotion/styled";
import { useCart } from "@/providers/CartProvider";
import CategoryTabs from "@/components/common/CategoryTabs";
import MenuItem from "./MenuItem";
import type { MenuItem as MenuItemType } from "@/types/menu";

interface MenuGridProps {
  menus: MenuItemType[];
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const LoadingText = styled.p`
  padding: ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
`;

const ErrorText = styled.p`
  padding: ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.danger};
  text-align: center;
`;

export default function MenuGrid({ menus }: MenuGridProps) {
  const { dispatch } = useCart();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // 카테고리 목록 추출
  const categories = useMemo(() => {
    const cats = new Set(menus.map((m) => m.category));
    return Array.from(cats);
  }, [menus]);

  // 선택된 카테고리의 메뉴만 필터링
  const filteredMenus = useMemo(() => {
    if (activeCategory === null) return menus;  // 전체/즐겨찾기
    return menus.filter((m) => m.category === activeCategory);
  }, [menus, activeCategory]);

  const handleMenuClick = (menu: MenuItemType) => {
    dispatch({ type: "ADD_ITEM", menu });
  };

  if (!menus || menus.length === 0) {
    return <LoadingText>등록된 메뉴가 없습니다.</LoadingText>;
  }

  return (
    <div>
      <CategoryTabs
        categories={categories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
        showFavorites={true}
      />
      <Grid>
        {filteredMenus.map((menu) => (
          <MenuItem key={menu.id} menu={menu} onClick={handleMenuClick} />
        ))}
      </Grid>
    </div>
  );
}
```

**기존 대비 변경사항:**

- `useMenus` 훅 호출을 **제거** — 데이터를 props로 받음 (Server Page → Client Shell 패턴)
- `CategoryTabs` 연동 추가 — 탭 선택에 따라 메뉴 필터링
- `useMemo`로 카테고리 목록과 필터링 결과를 메모이제이션

**데이터 흐름 변경:**

```
기존:
  MenuGrid → useMenus() → api.get("/api/menus") → 렌더링

변경 후:
  Server page.tsx → getMenus() → props → POSClientShell → MenuGrid
  MenuGrid는 props로 menus를 받아서 렌더링만 담당
```

이렇게 하면 MenuGrid는 **순수한 표현 컴포넌트**가 된다. 데이터 페칭은 상위에서 담당.

---

### Step 5-4. 장바구니 컴포넌트 — 매장/포장 토글 추가

#### 5-4-1. CartItem

**파일:** `frontend/src/components/pos/CartItem.tsx`

```typescript
"use client";

import styled from "@emotion/styled";
import { useCart, CartItem as CartItemType } from "@/providers/CartProvider";

interface CartItemProps {
  item: CartItemType;
}

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} 0`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Info = styled.div`
  flex: 1;
  min-width: 0;
`;

const Name = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Price = styled.p`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const QuantityControl = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const QtyButton = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  background: ${({ theme }) => theme.colors.surface};
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.primary};

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const Quantity = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  min-width: 24px;
  text-align: center;
`;

const DeleteButton = styled.button`
  color: ${({ theme }) => theme.colors.danger};
  font-size: ${({ theme }) => theme.fontSize.xs};
  padding: ${({ theme }) => theme.spacing.xs};

  &:hover {
    opacity: 0.7;
  }
`;

export default function CartItem({ item }: CartItemProps) {
  const { dispatch } = useCart();

  const subtotal = item.menu.price * item.quantity;

  return (
    <Row>
      <Info>
        <Name>{item.menu.name}</Name>
        <Price>{subtotal.toLocaleString()}원</Price>
      </Info>
      <QuantityControl>
        <QtyButton
          onClick={() =>
            dispatch({
              type: "UPDATE_QUANTITY",
              menuId: item.menu.id,
              quantity: item.quantity - 1,
            })
          }
        >
          -
        </QtyButton>
        <Quantity>{item.quantity}</Quantity>
        <QtyButton
          onClick={() =>
            dispatch({
              type: "UPDATE_QUANTITY",
              menuId: item.menu.id,
              quantity: item.quantity + 1,
            })
          }
        >
          +
        </QtyButton>
      </QuantityControl>
      <DeleteButton
        onClick={() => dispatch({ type: "REMOVE_ITEM", menuId: item.menu.id })}
      >
        삭제
      </DeleteButton>
    </Row>
  );
}
```

#### 5-4-2. Cart — 매장/포장 토글 추가

**파일:** `frontend/src/components/pos/Cart.tsx`

```typescript
"use client";

import styled from "@emotion/styled";
import { useCart } from "@/providers/CartProvider";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import CartItem from "./CartItem";
import Button from "@/components/common/Button";
import OrderModeToggle from "@/components/common/OrderModeToggle";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: ${({ theme }) => theme.colors.background};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
`;

const Header = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.h2`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const ItemList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => `0 ${theme.spacing.md}`};
`;

const EmptyMessage = styled.p`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.text.disabled};
  font-size: ${({ theme }) => theme.fontSize.sm};
`;

const Footer = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Summary = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SummaryLabel = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const SummaryAmount = styled.span`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

export default function Cart() {
  const { state, dispatch } = useCart();
  const createOrder = useCreateOrder();

  const handleOrder = () => {
    if (state.items.length === 0) return;

    // 임시 멱등성 키 (Phase 8에서 generateIdempotencyKey로 교체)
    const idempotencyKey = `pos_temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    createOrder.mutate(
      {
        items: state.items.map((item) => ({
          menu_id: item.menu.id,
          quantity: item.quantity,
        })),
        idempotency_key: idempotencyKey,
        order_mode: state.orderMode,
      },
      {
        onSuccess: () => {
          dispatch({ type: "CLEAR" });
        },
      },
    );
  };

  const totalQuantity = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <Container>
      <Header>
        <Title>장바구니</Title>
      </Header>

      <ItemList>
        {state.items.length === 0 ? (
          <EmptyMessage>메뉴를 선택해주세요</EmptyMessage>
        ) : (
          state.items.map((item) => (
            <CartItem key={item.menu.id} item={item} />
          ))
        )}
      </ItemList>

      <Footer>
        <OrderModeToggle />

        <Summary>
          <SummaryLabel>
            총 {totalQuantity}개
          </SummaryLabel>
          <SummaryAmount>
            {state.totalAmount.toLocaleString()}원
          </SummaryAmount>
        </Summary>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={handleOrder}
          disabled={state.items.length === 0 || createOrder.isPending}
        >
          {createOrder.isPending ? "주문 생성 중..." : "결제하기"}
        </Button>
      </Footer>
    </Container>
  );
}
```

**기존 대비 변경사항:**

- `<OrderModeToggle />` 추가 — 매장/포장 선택
- `order_mode: state.orderMode`를 주문 생성 요청에 포함
- 버튼 텍스트 "주문하기" → "결제하기" (실제 토스 POS 용어)
- `totalQuantity`를 별도 변수로 추출

**`handleOrder` 흐름:**

```
1. 장바구니 items를 API 형식으로 변환:
   CartItem { menu: { id: "abc" }, quantity: 2 }
   → OrderItemCreate { menu_id: "abc", quantity: 2 }

2. orderMode 포함 (매장/포장)

3. 임시 멱등성 키 생성 (Phase 8에서 generateIdempotencyKey로 교체)

4. createOrder.mutate() → POST /api/orders

5. 성공 시:
   - onSuccess 콜백 → dispatch({ type: "CLEAR" }) → 장바구니 비움
   - useCreateOrder 내부 → invalidateQueries(["orders"]) → 주문 목록 리페치

6. 실패 시:
   - useCreateOrder 내부 → onError → 주문 목록 롤백
   - createOrder.isError가 true → 에러 UI 표시 가능
```

---

### Step 5-5. POS 메인 페이지 — Server Page → Client Shell 패턴

이 Step이 Phase 4에서 설계한 **"Server Page → Client Shell"** 패턴의 실제 구현이다.

#### 5-5-1. POSClientShell (Client Component)

**파일:** `frontend/src/components/pos/POSClientShell.tsx`

서버에서 전달받은 메뉴 데이터로 POS 전체 화면을 렌더링하는 클라이언트 컴포넌트.

```typescript
"use client";

import Link from "next/link";
import styled from "@emotion/styled";
import { useMenus } from "@/hooks/useMenus";
import MenuGrid from "./MenuGrid";
import Cart from "./Cart";
import ThemeToggle from "@/components/common/ThemeToggle";
import type { MenuItem } from "@/types/menu";

interface POSClientShellProps {
  initialMenus: MenuItem[];
}

const PageLayout = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
`;

const MenuSection = styled.main`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const CartSection = styled.aside`
  width: 360px;
  flex-shrink: 0;
`;

const TopBar = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Logo = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
`;

const TopBarActions = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NavLink = styled(Link)`
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.sm}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  transition: background-color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const MenuArea = styled.div`
  flex: 1;
  overflow-y: auto;
`;

export default function POSClientShell({ initialMenus }: POSClientShellProps) {
  // useMenus 훅 사용 — 캐시 키, 리페치 설정이 중앙 관리됨
  const { data: menus } = useMenus(initialMenus);

  return (
    <PageLayout>
      <MenuSection>
        <TopBar>
          <Logo>Toss-Sync POS</Logo>
          <TopBarActions>
            <NavLink href="/kiosk">키오스크</NavLink>
            <NavLink href="/admin/orders">KDS</NavLink>
            <ThemeToggle />
          </TopBarActions>
        </TopBar>
        <MenuArea>
          <MenuGrid menus={menus ?? []} />
        </MenuArea>
      </MenuSection>
      <CartSection>
        <Cart />
      </CartSection>
    </PageLayout>
  );
}
```

**레이아웃 구조:**

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar                                                     │
│  [Toss-Sync POS]                    [키오스크] [KDS] [🌙]  │
├─────────────────────────────────────────────────────────────┤
│  CategoryTabs (MenuGrid 내부)                                │
│  [★ 즐겨찾기] [커피] [음료] [베이커리]                       │
├──────────────────────────────────┬──────────────────────────┤
│  MenuArea (flex: 1, scroll)      │  CartSection (360px)     │
│  ┌──────┐ ┌──────┐ ┌──────┐    │  ┌──────────────────────┐│
│  │아메  │ │카페  │ │바닐  │    │  │ 장바구니             ││
│  │리카노│ │라떼  │ │라라떼│    │  │                      ││
│  │4,500 │ │5,000 │ │5,500 │    │  │ 아메리카노 x2  9,000 ││
│  └──────┘ └──────┘ └──────┘    │  │                      ││
│                                  │  │ [매장] [포장]        ││
│                                  │  │ 총 2개    9,000원   ││
│                                  │  │ [    결제하기    ]   ││
│                                  │  └──────────────────────┘│
└──────────────────────────────────┴──────────────────────────┘
```

#### 5-5-2. POS 서버 페이지

**파일:** `frontend/src/app/(pos)/page.tsx`

```tsx
import { getMenus } from "@/lib/server-api";
import POSClientShell from "@/components/pos/POSClientShell";

export default async function POSPage() {
  let menus;
  try {
    menus = await getMenus();
  } catch {
    menus = [];   // 백엔드 미실행 시 빈 배열 → MenuGrid에서 "등록된 메뉴가 없습니다" 표시
  }

  return <POSClientShell initialMenus={menus} />;
}
```

**왜 `try/catch`로 감싸나?**

```
백엔드 실행 중:
  getMenus() → 메뉴 8개 → POSClientShell에 전달 → 즉시 렌더링

백엔드 미실행:
  getMenus() → fetch 실패 → catch → 빈 배열 → "등록된 메뉴가 없습니다"
  React-Query가 클라이언트에서 5초 후 리페치 시도 → 백엔드 켜지면 자동 표시
```

- 서버 fetch가 실패해도 **페이지 자체가 에러로 크래시하지 않음**
- 빈 배열을 전달하면 MenuGrid가 적절한 빈 상태 메시지를 보여줌
- 클라이언트에서 React-Query가 이후 리페치를 시도하므로 복구 가능

**왜 이 페이지에 `"use client"`가 없나?**

- 이것이 **Server Component**다 — 서버에서 `getMenus()`를 호출하고, 결과를 props로 전달
- `POSClientShell`이 `"use client"` 컴포넌트이므로 인터랙션은 거기서 처리
- `page.tsx`는 데이터 패칭만 담당, UI 렌더링은 클라이언트에 위임

---

### Step 5-6. 키오스크 페이지 기본 구조

고객이 매장에서 직접 주문하는 키오스크 화면. 같은 메뉴 데이터를 쓰되, UI가 다르다.

#### 5-6-1. KioskShell (Client Component)

**파일:** `frontend/src/components/kiosk/KioskShell.tsx`

```typescript
"use client";

import { useState, useMemo } from "react";
import styled from "@emotion/styled";
import { useMenus } from "@/hooks/useMenus";
import { useCart } from "@/providers/CartProvider";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import CategoryTabs from "@/components/common/CategoryTabs";
import Button from "@/components/common/Button";
import type { MenuItem } from "@/types/menu";

interface KioskShellProps {
  initialMenus: MenuItem[];
}

const KioskLayout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 768px;
  margin: 0 auto;
  background: ${({ theme }) => theme.colors.background};
`;

const KioskHeader = styled.header`
  padding: ${({ theme }) => `${theme.spacing.xl} ${theme.spacing.md}`};
  text-align: center;
`;

const KioskTitle = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xxl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const KioskSubtitle = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const MenuArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.md};
`;

const MenuGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
`;

const KioskMenuItem = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.lg};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.lg};
  transition: transform 0.1s;
  text-align: center;
  min-height: 160px;

  &:hover {
    transform: scale(1.02);
  }

  &:active {
    transform: scale(0.98);
  }
`;

const KioskMenuName = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const KioskMenuPrice = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const BottomBar = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
`;

const CartSummary = styled.div`
  flex: 1;
`;

const CartCount = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CartTotal = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  margin-left: ${({ theme }) => theme.spacing.md};
`;

export default function KioskShell({ initialMenus }: KioskShellProps) {
  const { data: menus } = useMenus(initialMenus);

  const { state, dispatch } = useCart();
  const createOrder = useCreateOrder();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set((menus ?? []).map((m) => m.category));
    return Array.from(cats);
  }, [menus]);

  const filteredMenus = useMemo(() => {
    if (activeCategory === null) return menus ?? [];
    return (menus ?? []).filter((m) => m.category === activeCategory);
  }, [menus, activeCategory]);

  const totalQuantity = state.items.reduce((sum, i) => sum + i.quantity, 0);

  const handleMenuClick = (menu: MenuItem) => {
    dispatch({ type: "ADD_ITEM", menu });
  };

  const handleOrder = () => {
    if (state.items.length === 0) return;

    const idempotencyKey = `kiosk_temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    createOrder.mutate(
      {
        items: state.items.map((item) => ({
          menu_id: item.menu.id,
          quantity: item.quantity,
        })),
        idempotency_key: idempotencyKey,
        order_mode: state.orderMode,
      },
      {
        onSuccess: () => {
          dispatch({ type: "CLEAR" });
        },
      },
    );
  };

  return (
    <KioskLayout>
      <KioskHeader>
        <KioskTitle>무엇을 주문하시겠어요?</KioskTitle>
        <KioskSubtitle>메뉴를 선택해주세요</KioskSubtitle>
      </KioskHeader>

      <CategoryTabs
        categories={categories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
      />

      <MenuArea>
        <MenuGrid>
          {filteredMenus.map((menu) => (
            <KioskMenuItem key={menu.id} onClick={() => handleMenuClick(menu)}>
              <KioskMenuName>{menu.name}</KioskMenuName>
              <KioskMenuPrice>{menu.price.toLocaleString()}원</KioskMenuPrice>
            </KioskMenuItem>
          ))}
        </MenuGrid>
      </MenuArea>

      {totalQuantity > 0 && (
        <BottomBar>
          <CartSummary>
            <CartCount>장바구니 {totalQuantity}개</CartCount>
            <CartTotal>{state.totalAmount.toLocaleString()}원</CartTotal>
          </CartSummary>
          <Button
            variant="primary"
            size="lg"
            onClick={handleOrder}
            disabled={createOrder.isPending}
          >
            {createOrder.isPending ? "주문 중..." : "주문하기"}
          </Button>
        </BottomBar>
      )}
    </KioskLayout>
  );
}
```

**POS vs 키오스크 차이점:**

| 항목 | POS (`/`) | 키오스크 (`/kiosk`) |
|------|-----------|-------------------|
| 대상 | 직원 | 고객 |
| 레이아웃 | 좌/우 분할 (메뉴+장바구니) | 세로 스택 (전체 화면) |
| 메뉴 카드 | 작은 카드 (140px) | 큰 카드 (2열, 160px+) |
| 장바구니 | 항상 표시 (우측) | 하단 바에 요약만 |
| 즐겨찾기 | 있음 (★ 탭) | 없음 |
| 매장/포장 | 토글 있음 | Phase 7에서 추가 |
| 네비게이션 | 키오스크/KDS 링크 | 없음 (단일 화면) |
| 최대 폭 | 제한 없음 | 768px (태블릿) |

#### 5-6-2. 키오스크 서버 페이지

**파일:** `frontend/src/app/kiosk/page.tsx`

```tsx
import { getMenus } from "@/lib/server-api";
import KioskShell from "@/components/kiosk/KioskShell";

export default async function KioskPage() {
  let menus;
  try {
    menus = await getMenus();
  } catch {
    menus = [];
  }

  return <KioskShell initialMenus={menus} />;
}
```

POS 페이지와 동일한 패턴 — 서버에서 메뉴 fetch → 클라이언트 Shell에 전달.

---

### Step 5-7. 테이블오더 페이지 기본 구조

QR코드를 스캔한 고객이 모바일 브라우저에서 주문하는 화면.

#### 5-7-1. TableOrderShell (Client Component)

**파일:** `frontend/src/components/order/TableOrderShell.tsx`

```typescript
"use client";

import { useState, useMemo } from "react";
import styled from "@emotion/styled";
import { useMenus } from "@/hooks/useMenus";
import { useCart } from "@/providers/CartProvider";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import CategoryTabs from "@/components/common/CategoryTabs";
import Button from "@/components/common/Button";
import type { MenuItem } from "@/types/menu";

interface TableOrderShellProps {
  tableId: string;
  initialMenus: MenuItem[];
}

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 480px;
  margin: 0 auto;
  background: ${({ theme }) => theme.colors.background};
`;

const Header = styled.header`
  padding: ${({ theme }) => theme.spacing.md};
  text-align: center;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const TableBadge = styled.div`
  display: inline-block;
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const MenuArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`;

const MenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const MenuRow = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.md};
  width: 100%;
  text-align: left;
  transition: background-color 0.15s;

  &:active {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const MenuInfo = styled.div`
  flex: 1;
`;

const MenuName = styled.p`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const MenuPrice = styled.p`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: 2px;
`;

const AddBadge = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  color: ${({ theme }) => theme.colors.primary};
`;

const BottomBar = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const CartInfo = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const CartLabel = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const CartAmount = styled.span`
  font-size: ${({ theme }) => theme.fontSize.lg};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
`;

export default function TableOrderShell({ tableId, initialMenus }: TableOrderShellProps) {
  const { data: menus } = useMenus(initialMenus);

  const { state, dispatch } = useCart();
  const createOrder = useCreateOrder();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set((menus ?? []).map((m) => m.category));
    return Array.from(cats);
  }, [menus]);

  const filteredMenus = useMemo(() => {
    if (activeCategory === null) return menus ?? [];
    return (menus ?? []).filter((m) => m.category === activeCategory);
  }, [menus, activeCategory]);

  const totalQuantity = state.items.reduce((sum, i) => sum + i.quantity, 0);

  const handleMenuClick = (menu: MenuItem) => {
    dispatch({ type: "ADD_ITEM", menu });
  };

  const handleOrder = () => {
    if (state.items.length === 0) return;

    const idempotencyKey = `table_${tableId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    createOrder.mutate(
      {
        items: state.items.map((item) => ({
          menu_id: item.menu.id,
          quantity: item.quantity,
        })),
        idempotency_key: idempotencyKey,
        order_mode: "DINE_IN",   // 테이블오더는 항상 매장
      },
      {
        onSuccess: () => {
          dispatch({ type: "CLEAR" });
        },
      },
    );
  };

  return (
    <Layout>
      <Header>
        <TableBadge>테이블 {tableId}</TableBadge>
        <Title>메뉴를 선택해주세요</Title>
      </Header>

      <CategoryTabs
        categories={categories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
      />

      <MenuArea>
        <MenuList>
          {filteredMenus.map((menu) => (
            <MenuRow key={menu.id} onClick={() => handleMenuClick(menu)}>
              <MenuInfo>
                <MenuName>{menu.name}</MenuName>
                <MenuPrice>{menu.price.toLocaleString()}원</MenuPrice>
              </MenuInfo>
              <AddBadge>+</AddBadge>
            </MenuRow>
          ))}
        </MenuList>
      </MenuArea>

      {totalQuantity > 0 && (
        <BottomBar>
          <CartInfo>
            <CartLabel>{totalQuantity}개 선택</CartLabel>
            <CartAmount>{state.totalAmount.toLocaleString()}원</CartAmount>
          </CartInfo>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleOrder}
            disabled={createOrder.isPending}
          >
            {createOrder.isPending ? "주문 중..." : "주문하기"}
          </Button>
        </BottomBar>
      )}
    </Layout>
  );
}
```

**POS / 키오스크 / 테이블오더 비교:**

| 항목 | POS | 키오스크 | 테이블오더 |
|------|-----|---------|----------|
| 최대 폭 | 제한 없음 | 768px (태블릿) | 480px (모바일) |
| 메뉴 레이아웃 | 그리드 (auto-fill) | 2열 그리드 | 리스트 (세로) |
| 장바구니 | 우측 패널 | 하단 바 | 하단 바 |
| 테이블 표시 | 없음 | 없음 | 상단 뱃지 |
| orderMode | 매장/포장 선택 | 선택 | 항상 DINE_IN |

#### 5-7-2. 테이블오더 서버 페이지

**파일:** `frontend/src/app/order/[tableId]/page.tsx`

```tsx
import { getMenus } from "@/lib/server-api";
import TableOrderShell from "@/components/order/TableOrderShell";

export default async function TableOrderPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;

  let menus;
  try {
    menus = await getMenus();
  } catch {
    menus = [];
  }

  return <TableOrderShell tableId={tableId} initialMenus={menus} />;
}
```

**`params`가 `Promise`인 이유:**

Next.js 15+에서 동적 라우트의 `params`는 비동기로 전달된다. `await params`로 테이블 ID를 추출한다.

```
URL: /order/3
  → params = { tableId: "3" }
  → 서버에서 메뉴 fetch
  → TableOrderShell에 tableId="3"과 menus 전달
```

---

## 검증 체크리스트

> **전제:** 백엔드 서버가 실행 중이어야 한다 (`cd backend && uvicorn app.main:app --reload`)

- [ ] **빌드 확인**

  ```bash
  cd frontend && npm run build
  # → 에러 없이 빌드 성공
  ```

- [ ] **POS 메인 화면** (`http://localhost:3000`)
  - 카테고리 탭 표시 (★ 즐겨찾기, 커피, 음료, 베이커리)
  - 탭 클릭 → 해당 카테고리 메뉴만 표시
  - 메뉴 클릭 → 장바구니 추가
  - 수량 +/- 동작, 삭제 동작
  - 매장/포장 토글 동작
  - 총 수량/금액 정확
  - "결제하기" → 주문 생성 → 장바구니 비움

- [ ] **키오스크 화면** (`http://localhost:3000/kiosk`)
  - "무엇을 주문하시겠어요?" 헤더 표시
  - 큰 메뉴 카드 (2열)
  - 메뉴 클릭 → 하단 장바구니 바 나타남
  - 주문하기 → 주문 생성

- [ ] **테이블오더 화면** (`http://localhost:3000/order/1`)
  - "테이블 1" 뱃지 표시
  - 모바일 최적화 리스트 레이아웃 (max-width: 480px)
  - 메뉴 클릭 → 하단 바 나타남
  - 주문하기 → 주문 생성

- [ ] **테마 전환**
  - POS 화면에서 🌙/☀️ 버튼 클릭 → 전체 테마 전환
  - 새로고침 후에도 유지

- [ ] **백엔드 미실행 시**
  - 모든 페이지에서 크래시 없음
  - POS: "등록된 메뉴가 없습니다." 표시
  - 백엔드 켜면 → 5초 후 자동으로 메뉴 표시 (React-Query 리페치)

- [ ] **주문 확인**

  ```bash
  curl http://localhost:8000/api/orders | python -m json.tool
  # → POS, 키오스크, 테이블오더에서 생성한 주문이 모두 포함
  ```

---

## 다음 단계

→ **Phase 6**: 백엔드 결제 API & Toss 연동. POS/키오스크/테이블오더에서 주문 생성까지 동작하니, 이제 "결제하기" 이후의 결제 흐름을 위한 백엔드 API를 만든다.
