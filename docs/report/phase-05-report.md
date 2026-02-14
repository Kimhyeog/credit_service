# Phase 5 구현 보고서 — POS + 키오스크 + 테이블오더 UI

> **구현 일자:** 2026-02-14
>
> **범위:** React-Query 훅 3개 + 공통 UI 4개 + POS 컴포넌트 4개 + Shell 3개 + 페이지 수정 3개 = **총 17파일**
>
> **빌드 검증:** `npm run build` 타입 에러 0, 빌드 성공

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [Step 5-1: React-Query Hooks](#2-step-5-1-react-query-hooks)
3. [Step 5-2: 공통 UI 컴포넌트](#3-step-5-2-공통-ui-컴포넌트)
4. [Step 5-3: 메뉴 컴포넌트](#4-step-5-3-메뉴-컴포넌트)
5. [Step 5-4: 장바구니 컴포넌트](#5-step-5-4-장바구니-컴포넌트)
6. [Step 5-5: POS 메인 화면](#6-step-5-5-pos-메인-화면)
7. [Step 5-6: 키오스크 화면](#7-step-5-6-키오스크-화면)
8. [Step 5-7: 테이블오더 화면](#8-step-5-7-테이블오더-화면)
9. [세 화면 비교표](#9-세-화면-비교표)
10. [데이터 흐름 다이어그램](#10-데이터-흐름-다이어그램)
11. [파일 목록 총정리](#11-파일-목록-총정리)

---

## 1. 아키텍처 개요

### Server Page → Client Shell 패턴

Phase 5의 핵심 아키텍처는 **"Server Page → Client Shell"** 패턴이다. 모든 페이지가 동일한 구조를 따른다:

```
┌─────────────────────────────────────────────────────┐
│  Server Component (page.tsx)                        │
│  ① getMenus() — 서버에서 메뉴 데이터 fetch         │
│  ② try/catch — 백엔드 미실행 시 빈 배열 fallback    │
│  ③ props로 Client Shell에 전달                      │
├─────────────────────────────────────────────────────┤
│  Client Shell ("use client")                        │
│  ④ useMenus(initialData) — React-Query 캐시 주입    │
│  ⑤ staleTime 5초 후 백그라운드 리페치               │
│  ⑥ 인터랙션 처리 (장바구니, 주문 생성 등)           │
└─────────────────────────────────────────────────────┘
```

**이 패턴의 이점:**

| 이점 | 설명 |
|------|------|
| SSR 즉시 렌더링 | 서버에서 데이터를 미리 가져오므로 로딩 스피너 없이 즉시 화면 표시 |
| SEO 친화적 | HTML에 메뉴 데이터가 포함되어 검색 엔진 크롤링 가능 |
| 점진적 업데이트 | React-Query가 5초 후 백그라운드 리페치로 최신 데이터 반영 |
| 장애 허용 | 백엔드 미실행 시에도 빈 배열로 graceful degradation |

### 컴포넌트 계층 구조

```
AppProviders (QueryProvider → ThemeProvider → CartProvider)
└── page.tsx (Server Component)
    └── *Shell (Client Component)
        ├── useMenus(initialData)    ← React-Query 훅
        ├── useCart()                ← CartProvider 컨텍스트
        ├── useCreateOrder()        ← Mutation 훅
        ├── CategoryTabs            ← 공통 UI
        ├── MenuItem / MenuGrid     ← 메뉴 표현
        ├── CartItem / Cart         ← 장바구니 표현
        ├── OrderModeToggle         ← 매장/포장
        ├── ThemeToggle             ← 다크모드
        └── Button                  ← 공통 버튼
```

---

## 2. Step 5-1: React-Query Hooks

컴포넌트에서 직접 `api.get()`을 호출하지 않고 **커스텀 훅**을 통하는 이유:
- 캐시 키, 폴링 간격, 에러 재시도 설정을 **한 곳에서 관리**
- 여러 컴포넌트에서 같은 쿼리를 호출하면 React-Query가 **자동 중복 제거** (네트워크 요청 1회)
- 컴포넌트는 `data`, `isLoading`, `isError`만 알면 되므로 **관심사 분리**

### 2-1. useMenus (`src/hooks/useMenus.ts`)

| 항목 | 내용 |
|------|------|
| **역할** | 메뉴 목록 조회 (`GET /api/menus`) |
| **queryKey** | `["menus"]` |
| **핵심 기능** | `initialData` 파라미터로 SSR 데이터 주입 |
| **캐싱 전략** | QueryProvider의 기본 `staleTime: 5초` 적용 |

**SSR Hydration 흐름:**

```
1. Server Component에서 getMenus() → 메뉴 8개
2. props로 Client Shell에 전달
3. Client Shell에서 useMenus(initialMenus) 호출
4. React-Query는 initialData로 즉시 캐시에 저장 → 로딩 스피너 없음
5. staleTime(5초) 후 백그라운드 리페치 → 최신 데이터로 교체
```

**사용처:** POSClientShell, KioskShell, TableOrderShell (3곳 모두 동일 패턴)

### 2-2. useOrders (`src/hooks/useOrders.ts`)

이 파일은 두 개의 훅을 export한다:

#### useOrders(status?)

| 항목 | 내용 |
|------|------|
| **역할** | 주문 목록 조회 (`GET /api/orders`) |
| **queryKey** | `["orders", { status }]` |
| **핵심 기능** | 3초 간격 자동 폴링 (실시간 주문 상태 반영) |
| **옵션** | `refetchIntervalInBackground: true` — 탭이 백그라운드여도 폴링 유지 |

**3초 폴링을 선택한 이유:**

POS 환경에서 주문 상태가 실시간으로 바뀌어야 하는 시나리오가 있다:
- 고객이 결제 완료 → 주문 상태가 PENDING → PAID로 변경
- POS 화면에서 이 변경이 즉시 반영되어야 직원이 주문 처리 가능
- WebSocket 대신 폴링을 사용하면 별도 WS 서버가 불필요하고 코드가 간결

#### useOrder(orderId)

| 항목 | 내용 |
|------|------|
| **역할** | 주문 상세 조회 (`GET /api/orders/{id}`) |
| **queryKey** | `["orders", orderId]` |
| **핵심 기능** | `enabled: !!orderId` — orderId가 있을 때만 쿼리 실행 |

**사용처:** Phase 5에서는 직접 사용하지 않으나, 향후 KDS(주방 디스플레이), 주문 상세 화면에서 사용 예정

### 2-3. useCreateOrder (`src/hooks/useCreateOrder.ts`)

| 항목 | 내용 |
|------|------|
| **역할** | 주문 생성 Mutation (`POST /api/orders`) |
| **핵심 기능** | 낙관적 업데이트 + 롤백 |
| **헤더** | `Idempotency-Key` — 멱등성 키를 헤더로 전송 |

**낙관적 업데이트 흐름:**

```
1. 사용자가 "결제하기" / "주문하기" 클릭
2. onMutate: 진행 중인 orders 쿼리 취소 + 현재 캐시 스냅샷 저장 (previous)
3. mutationFn: POST /api/orders 서버 호출 (비동기)
4. 성공 → onSuccess: orders 캐시 무효화 → 서버 최신 데이터로 교체
5. 실패 → onError: previous로 롤백 → UI가 원래 상태로 복구
```

**사용처:** Cart (POS), KioskShell, TableOrderShell (3곳 모두에서 주문 생성 시 사용)

---

## 3. Step 5-2: 공통 UI 컴포넌트

POS, 키오스크, 테이블오더 세 화면에서 **재사용**되는 공통 컴포넌트들이다.

### 3-1. Button (`src/components/common/Button.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 프로젝트 전역에서 사용하는 범용 버튼 |
| **구현 방식** | Emotion `styled.button` — 테마 토큰 기반 |
| **타입** | `"use client"` (인터랙티브 요소) |

**Props:**

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `variant` | `"primary" \| "danger" \| "ghost"` | `"primary"` | 버튼 스타일 변형 |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | 버튼 크기 |
| `fullWidth` | `boolean` | `false` | `true`이면 `width: 100%` |

**variant별 스타일:**

| Variant | 배경색 | 호버 효과 | 용도 |
|---------|--------|----------|------|
| `primary` | `theme.colors.primary` (토스 블루) | `primaryHover` 색상 | 결제, 주문 등 주요 액션 |
| `danger` | `theme.colors.danger` (빨강) | `opacity: 0.9` | 삭제, 취소 등 위험 액션 |
| `ghost` | 투명 | `surfaceHover` 배경 | 보조 액션, 네비게이션 |

**disabled 상태:** `opacity: 0.5` + `cursor: not-allowed`

**사용처:** Cart 결제 버튼, KioskShell 주문 버튼, TableOrderShell 주문 버튼

### 3-2. ThemeToggle (`src/components/common/ThemeToggle.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 라이트/다크 모드 전환 버튼 |
| **의존성** | `useThemeMode()` (ThemeProvider에서 제공) |
| **표시** | 라이트 모드: 🌙 / 다크 모드: ☀️ |

**동작 원리:**

```
1. useThemeMode()에서 현재 mode("light" | "dark")와 toggle 함수를 가져옴
2. 버튼 클릭 → toggle() → ThemeProvider의 mode 상태 변경
3. ThemeProvider가 Emotion theme 객체를 교체 → 전체 UI 테마 전환
4. localStorage에 저장 → 새로고침 후에도 유지
```

**사용처:** POSClientShell TopBar (POS 화면 우측 상단)

### 3-3. CategoryTabs (`src/components/common/CategoryTabs.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 메뉴 카테고리를 전환하는 탭 바 |
| **핵심 기능** | 가로 스크롤, 즐겨찾기(★) 탭 옵션 |
| **접근성** | 각 탭은 `<button>` — 키보드 탐색 가능 |

**Props:**

| Prop | 타입 | 설명 |
|------|------|------|
| `categories` | `string[]` | 카테고리 목록 (예: `["커피", "음료", "베이커리"]`) |
| `activeCategory` | `string \| null` | 현재 선택된 카테고리. `null`이면 전체/즐겨찾기 |
| `onSelect` | `(category: string \| null) => void` | 탭 선택 콜백 |
| `showFavorites` | `boolean` | `true`: 첫 탭이 "★ 즐겨찾기" / `false`: "전체" |

**탭 스타일:**

- **활성 탭:** 토스 블루 배경 + 흰색 텍스트
- **비활성 탭:** 회색 배경 + 보조 텍스트 색상, 호버 시 surfaceHover

**가로 스크롤:** 카테고리가 많아져도 `overflow-x: auto`로 수평 스크롤 가능. `-webkit-overflow-scrolling: touch`로 모바일 터치 스크롤 최적화. 스크롤바는 CSS로 숨김 처리.

**사용처:**
- MenuGrid (POS) — `showFavorites={true}` → "★ 즐겨찾기" 탭 표시
- KioskShell — `showFavorites` 미지정(기본 `false`) → "전체" 탭 표시
- TableOrderShell — `showFavorites` 미지정(기본 `false`) → "전체" 탭 표시

### 3-4. OrderModeToggle (`src/components/common/OrderModeToggle.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 매장(DINE_IN) / 포장(TAKE_OUT) 주문 모드 전환 |
| **의존성** | `useCart()` (CartProvider에서 제공) |
| **표시** | 세그먼트 컨트롤 형태 (좌: 매장, 우: 포장) |

**동작 원리:**

```
1. useCart()에서 현재 state.orderMode와 dispatch를 가져옴
2. "매장" 클릭 → dispatch({ type: "SET_ORDER_MODE", mode: "DINE_IN" })
3. "포장" 클릭 → dispatch({ type: "SET_ORDER_MODE", mode: "TAKE_OUT" })
4. CartProvider가 상태 업데이트 → UI 반영 + 주문 생성 시 order_mode로 전송
```

**실제 매장 시나리오:**

```
직원: "매장이세요 포장이세요?"
고객: "포장이요"
직원: [포장] 탭 클릭 → 주문 모드가 TAKE_OUT으로 변경
→ 주문 생성 시 order_mode: "TAKE_OUT"으로 서버에 전송
→ 향후 KDS에서 포장 주문은 별도 표시
```

**사용처:** Cart 컴포넌트 (POS 장바구니 하단)

---

## 4. Step 5-3: 메뉴 컴포넌트

### 4-1. MenuItem (`src/components/pos/MenuItem.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 개별 메뉴 항목을 카드 형태로 표시 |
| **핵심 기능** | 카테고리별 색상 코딩 + 큰 터치 영역 |
| **인터랙션** | 클릭 시 `onClick(menu)` 콜백 → 장바구니 추가 |

**Props:**

| Prop | 타입 | 설명 |
|------|------|------|
| `menu` | `MenuItemType` | 메뉴 데이터 (id, name, price, category 등) |
| `onClick` | `(menu: MenuItemType) => void` | 클릭 핸들러 |

**카테고리 색상 매핑 (`getCategoryColorKey`):**

| 카테고리 | 색상 키 | 라이트 모드 색상 | 다크 모드 색상 |
|----------|---------|----------------|---------------|
| 커피/coffee | `coffee` | `#8B6544` (갈색) | `#C4956A` |
| 음료/beverage | `beverage` | `#3182F6` (파랑) | `#5BA0F8` |
| 베이커리/bakery | `bakery` | `#FF9F00` (주황) | `#FFB84D` |
| 기타 | `default` | `#666666` (회색) | `#999999` |

**카드 구조:**

```
┌──────────────────────┐
│ ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ │  ← 3px 상단 색상 바 (카테고리 색상)
│                      │
│     [ 커피 ]         │  ← 카테고리 라벨 (색상 배경 뱃지)
│    아메리카노         │  ← 메뉴 이름 (굵게)
│     4,500원          │  ← 가격 (보조 색상)
│                      │
└──────────────────────┘
```

**`useTheme()`을 사용하는 이유:**

테마 객체에서 카테고리 색상을 동적으로 가져오기 위함이다. `theme.colors.category[colorKey]`로 접근하면 다크모드 전환 시 자동으로 대응하는 다크 색상이 적용된다.

**`<button>`을 사용하는 이유:**

메뉴 카드를 클릭하면 장바구니에 추가되는 인터랙티브 요소이므로, `<div onClick>`보다 `<button>`이 접근성(키보드 탐색, 스크린 리더)에 좋다.

**사용처:** MenuGrid 내부에서 반복 렌더링

### 4-2. MenuGrid (`src/components/pos/MenuGrid.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 메뉴 카드를 CSS Grid로 배치 + CategoryTabs 연동 |
| **핵심 기능** | 카테고리 필터링, auto-fill 반응형 그리드 |
| **빈 상태** | 메뉴가 없으면 "등록된 메뉴가 없습니다." 표시 |

**Props:**

| Prop | 타입 | 설명 |
|------|------|------|
| `menus` | `MenuItemType[]` | 표시할 메뉴 목록 (상위에서 전달) |

**내부 상태 관리:**

```typescript
const [activeCategory, setActiveCategory] = useState<string | null>(null);
```

- `null` → 전체 메뉴 표시 (즐겨찾기 탭 선택 시)
- `"커피"` 등 → 해당 카테고리 메뉴만 필터링

**성능 최적화 — `useMemo` 사용:**

```typescript
// 카테고리 목록 추출 — menus가 변경될 때만 재계산
const categories = useMemo(() => {
  const cats = new Set(menus.map((m) => m.category));
  return Array.from(cats);
}, [menus]);

// 필터링 결과 — menus 또는 activeCategory가 변경될 때만 재계산
const filteredMenus = useMemo(() => {
  if (activeCategory === null) return menus;
  return menus.filter((m) => m.category === activeCategory);
}, [menus, activeCategory]);
```

**CSS Grid:**

```css
grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
```

- `auto-fill` — 컨테이너 너비에 따라 열 수 자동 결정
- `minmax(140px, 1fr)` — 최소 140px, 최대 1fr로 유연한 크기

**데이터 흐름 (중요한 설계 변경):**

```
기존 (Phase 5 이전):
  MenuGrid → useMenus() → api.get("/api/menus") → 렌더링

Phase 5 이후:
  Server page.tsx → getMenus() → props → POSClientShell → useMenus(initialData) → MenuGrid
  MenuGrid는 props로 menus를 받아서 렌더링만 담당 (순수한 표현 컴포넌트)
```

**사용처:** POSClientShell 내부 MenuArea

---

## 5. Step 5-4: 장바구니 컴포넌트

### 5-1. CartItem (`src/components/pos/CartItem.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 장바구니 내 개별 항목 표시 (수량 조절, 삭제) |
| **의존성** | `useCart()` — dispatch로 수량 변경/삭제 액션 발행 |
| **레이아웃** | 가로 한 줄: [메뉴명 + 소계] [- 수량 +] [삭제] |

**Props:**

| Prop | 타입 | 설명 |
|------|------|------|
| `item` | `CartItemType` | `{ menu: MenuItem, quantity: number }` |

**인터랙션:**

| 액션 | dispatch 호출 | 결과 |
|------|--------------|------|
| `+` 버튼 | `UPDATE_QUANTITY { quantity: item.quantity + 1 }` | 수량 1 증가 |
| `-` 버튼 | `UPDATE_QUANTITY { quantity: item.quantity - 1 }` | 수량 1 감소. 0이면 자동 삭제 |
| 삭제 버튼 | `REMOVE_ITEM { menuId }` | 항목 즉시 삭제 |

**소계 계산:** `item.menu.price * item.quantity` → `toLocaleString()` + "원"

**CartItem 행 구조:**

```
┌──────────────────────────────────────────────────┐
│  아메리카노        │  [−] 2 [+]        │  삭제   │
│  9,000원           │                    │         │
├──────────────────────────────────────────────────┤
│  border-bottom: 1px solid border                  │
└──────────────────────────────────────────────────┘
```

**사용처:** Cart 컴포넌트 내부 ItemList

### 5-2. Cart (`src/components/pos/Cart.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | POS 우측 사이드바 — 장바구니 전체 관리 |
| **의존성** | `useCart()`, `useCreateOrder()` |
| **구성** | 헤더 + 아이템 목록 + 푸터(매장/포장 + 합계 + 결제 버튼) |

**레이아웃 구조:**

```
┌─────────────────────────────┐
│  장바구니                    │  ← Header (고정)
├─────────────────────────────┤
│  아메리카노 x2     9,000원   │  ← ItemList (스크롤 가능)
│  카페라떼   x1     5,000원   │
│  ...                         │
│                              │
├─────────────────────────────┤
│  [매장]  [포장]              │  ← OrderModeToggle
│  총 3개          14,000원    │  ← Summary
│  [     결제하기     ]        │  ← Button (primary, lg, fullWidth)
└─────────────────────────────┘   ← Footer (고정)
```

**빈 상태:** 아이템이 없으면 "메뉴를 선택해주세요" 메시지 표시

**주문 생성 흐름 (`handleOrder`):**

```
1. 장바구니 items를 API 형식으로 변환:
   CartItem { menu: { id: "abc" }, quantity: 2 }
   → OrderItemCreate { menu_id: "abc", quantity: 2 }

2. orderMode 포함 (매장/포장)

3. 임시 멱등성 키 생성: `pos_temp_{timestamp}_{random}`
   (Phase 8에서 generateIdempotencyKey로 교체 예정)

4. createOrder.mutate() → POST /api/orders

5. 성공 시:
   - onSuccess 콜백 → dispatch({ type: "CLEAR" }) → 장바구니 비움
   - useCreateOrder 내부 → invalidateQueries(["orders"]) → 주문 목록 리페치

6. 실패 시:
   - useCreateOrder 내부 → onError → 주문 목록 롤백
   - createOrder.isError가 true → 에러 UI 표시 가능
```

**버튼 상태:**
- 장바구니 비어있으면 → `disabled`
- 주문 생성 중이면 (`createOrder.isPending`) → `disabled` + 텍스트 "주문 생성 중..."

**사용처:** POSClientShell CartSection

---

## 6. Step 5-5: POS 메인 화면

### 6-1. POSClientShell (`src/components/pos/POSClientShell.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | POS 전체 화면 레이아웃 — 좌측 메뉴 + 우측 장바구니 |
| **타입** | Client Component (`"use client"`) |
| **핵심 기능** | useMenus(initialData)로 SSR 데이터 주입, 2단 레이아웃 |

**Props:**

| Prop | 타입 | 설명 |
|------|------|------|
| `initialMenus` | `MenuItem[]` | 서버에서 가져온 메뉴 데이터 |

**레이아웃 구조 (전체 화면):**

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar                                                      │
│  [Toss-Sync POS]                    [키오스크] [KDS] [🌙]   │
├─────────────────────────────────────────────────────────────┤
│  CategoryTabs (MenuGrid 내부)                                │
│  [★ 즐겨찾기] [커피] [음료] [베이커리]                        │
├──────────────────────────────────┬──────────────────────────┤
│  MenuArea (flex: 1, scroll)      │  CartSection (360px)     │
│  ┌──────┐ ┌──────┐ ┌──────┐    │  ┌──────────────────────┐│
│  │아메  │ │카페  │ │바닐  │    │  │ 장바구니              ││
│  │리카노│ │라떼  │ │라라떼│    │  │                       ││
│  │4,500 │ │5,000 │ │5,500 │    │  │ 아메리카노 x2  9,000 ││
│  └──────┘ └──────┘ └──────┘    │  │                       ││
│                                  │  │ [매장] [포장]         ││
│                                  │  │ 총 2개    9,000원    ││
│                                  │  │ [    결제하기    ]    ││
│                                  │  └──────────────────────┘│
└──────────────────────────────────┴──────────────────────────┘
```

**CSS 구조:**

| 요소 | 스타일 | 역할 |
|------|--------|------|
| `PageLayout` | `display: flex; height: 100vh; overflow: hidden` | 전체 화면 2단 분할 |
| `MenuSection` | `flex: 1; display: flex; flex-direction: column` | 좌측 메뉴 영역 |
| `CartSection` | `width: 360px; flex-shrink: 0` | 우측 장바구니 고정 너비 |
| `TopBar` | `display: flex; justify-content: space-between` | 상단 네비게이션 |
| `MenuArea` | `flex: 1; overflow-y: auto` | 메뉴 스크롤 영역 |

**TopBar 네비게이션:**

| 링크 | 경로 | 설명 |
|------|------|------|
| 키오스크 | `/kiosk` | 키오스크 모드로 전환 |
| KDS | `/admin/orders` | 주방 디스플레이로 이동 |
| 🌙/☀️ | (ThemeToggle) | 다크/라이트 모드 전환 |

### 6-2. POS 서버 페이지 (`src/app/(pos)/page.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 서버에서 메뉴 데이터를 fetch하여 POSClientShell에 전달 |
| **타입** | Server Component (async function, `"use client"` 없음) |
| **에러 처리** | try/catch — 백엔드 미실행 시 빈 배열 fallback |

**빌드 결과:** `○ /` — 정적 프리렌더링 (ISR, 1분 revalidate)

---

## 7. Step 5-6: 키오스크 화면

### 7-1. KioskShell (`src/components/kiosk/KioskShell.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | 고객 셀프 주문용 키오스크 전체 화면 |
| **타입** | Client Component (`"use client"`) |
| **대상 사용자** | 매장 고객 (태블릿 터치) |
| **최대 폭** | 768px (태블릿 최적화) |

**POS와의 차이점:**

| 항목 | POS | 키오스크 |
|------|-----|---------|
| 레이아웃 | 좌/우 분할 (메뉴+장바구니) | 세로 스택 (전체 화면) |
| 메뉴 카드 | 작은 카드 (140px auto-fill) | 큰 카드 (2열 고정, 160px+) |
| 장바구니 | 항상 표시 (우측 360px) | 하단 바에 요약만 (아이템 있을 때) |
| 즐겨찾기 | ★ 탭 있음 | 없음 (전체 탭) |
| 매장/포장 | OrderModeToggle 있음 | 없음 |
| 네비게이션 | 키오스크/KDS 링크 | 없음 (단일 화면) |
| 최대 폭 | 제한 없음 | 768px |
| 헤더 텍스트 | "Toss-Sync POS" | "무엇을 주문하시겠어요?" |

**레이아웃 구조:**

```
┌─────────────────────────────────────┐
│        무엇을 주문하시겠어요?        │  ← KioskHeader
│         메뉴를 선택해주세요          │
├─────────────────────────────────────┤
│  [전체] [커피] [음료] [베이커리]     │  ← CategoryTabs
├─────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐      │  ← MenuGrid (2열)
│  │ 아메리카노 │  │  카페라떼  │      │
│  │  4,500원   │  │  5,000원   │      │
│  └───────────┘  └───────────┘      │
│  ┌───────────┐  ┌───────────┐      │
│  │ 바닐라라떼 │  │  녹차라떼  │      │
│  │  5,500원   │  │  5,000원   │      │
│  └───────────┘  └───────────┘      │
├─────────────────────────────────────┤
│  장바구니 2개              9,500원   │  ← BottomBar (아이템 있을 때만)
│                    [  주문하기  ]    │
└─────────────────────────────────────┘
```

**BottomBar 조건부 렌더링:**

```typescript
{totalQuantity > 0 && (
  <BottomBar>...</BottomBar>
)}
```

장바구니에 아이템이 없으면 하단 바가 완전히 숨겨져서, 화면 전체를 메뉴 탐색에 사용할 수 있다.

**멱등성 키 접두사:** `kiosk_temp_` (POS: `pos_temp_`, 테이블오더: `table_{tableId}_`)

### 7-2. 키오스크 서버 페이지 (`src/app/kiosk/page.tsx`)

POS 페이지와 동일한 Server Page → Client Shell 패턴.

**빌드 결과:** `○ /kiosk` — 정적 프리렌더링 (ISR, 1분 revalidate)

---

## 8. Step 5-7: 테이블오더 화면

### 8-1. TableOrderShell (`src/components/order/TableOrderShell.tsx`)

| 항목 | 내용 |
|------|------|
| **역할** | QR 스캔 후 모바일에서 주문하는 테이블오더 화면 |
| **타입** | Client Component (`"use client"`) |
| **대상 사용자** | 매장 고객 (모바일 브라우저) |
| **최대 폭** | 480px (모바일 최적화) |

**키오스크와의 차이점:**

| 항목 | 키오스크 | 테이블오더 |
|------|---------|----------|
| 최대 폭 | 768px (태블릿) | 480px (모바일) |
| 메뉴 레이아웃 | 2열 그리드 (큰 카드) | 세로 리스트 (행 형태) |
| 테이블 표시 | 없음 | 상단 테이블 번호 뱃지 |
| orderMode | CartProvider 상태 따름 | 항상 `"DINE_IN"` (매장 내 주문) |
| 메뉴 클릭 UI | 카드 전체가 버튼 | 행 오른쪽에 `+` 뱃지 |

**Props:**

| Prop | 타입 | 설명 |
|------|------|------|
| `tableId` | `string` | URL에서 추출한 테이블 번호 (예: `"1"`, `"3"`) |
| `initialMenus` | `MenuItem[]` | 서버에서 가져온 메뉴 데이터 |

**레이아웃 구조:**

```
┌───────────────────────────────┐
│      [ 테이블 1 ]             │  ← TableBadge (토스 블루 배경)
│   메뉴를 선택해주세요          │  ← Title
├───────────────────────────────┤
│  [전체] [커피] [음료] [베이커리]│  ← CategoryTabs
├───────────────────────────────┤
│  ┌───────────────────────┐    │  ← MenuList (세로 리스트)
│  │ 아메리카노      4,500원 + │    │
│  └───────────────────────┘    │
│  ┌───────────────────────┐    │
│  │ 카페라떼        5,000원 + │    │
│  └───────────────────────┘    │
│  ...                          │
├───────────────────────────────┤
│  2개 선택            9,500원   │  ← BottomBar (아이템 있을 때만)
│  [       주문하기        ]     │
└───────────────────────────────┘
```

**orderMode가 항상 "DINE_IN"인 이유:**

테이블오더는 매장 안의 테이블에서 QR을 스캔하여 주문하는 것이므로, 반드시 매장 식사(DINE_IN)이다. 포장 옵션이 불필요하다.

**멱등성 키 접두사:** `table_{tableId}_` — 테이블 번호가 포함되어 추적 용이

### 8-2. 테이블오더 서버 페이지 (`src/app/order/[tableId]/page.tsx`)

| 항목 | 내용 |
|------|------|
| **동적 라우트** | `[tableId]` → URL 경로에서 테이블 ID 추출 |
| **params** | `Promise<{ tableId: string }>` — Next.js 15+ 비동기 params |

```
URL: /order/3
→ params = { tableId: "3" }
→ 서버에서 메뉴 fetch
→ TableOrderShell에 tableId="3"과 menus 전달
```

**빌드 결과:** `ƒ /order/[tableId]` — 동적 서버 렌더링 (매 요청마다)

---

## 9. 세 화면 비교표

| 항목 | POS (`/`) | 키오스크 (`/kiosk`) | 테이블오더 (`/order/[tableId]`) |
|------|-----------|--------------------|-----------------------------|
| **사용자** | 매장 직원 | 고객 (셀프, 태블릿) | 고객 (모바일, QR 스캔) |
| **최대 폭** | 제한 없음 | 768px | 480px |
| **메뉴 레이아웃** | auto-fill 그리드 (140px) | 2열 고정 그리드 | 세로 리스트 |
| **장바구니** | 우측 패널 (360px, 상시) | 하단 바 (요약, 조건부) | 하단 바 (요약, 조건부) |
| **카테고리 탭** | ★ 즐겨찾기 + 카테고리 | 전체 + 카테고리 | 전체 + 카테고리 |
| **매장/포장** | OrderModeToggle | 없음 | 없음 (항상 DINE_IN) |
| **테이블 표시** | 없음 | 없음 | 상단 뱃지 |
| **테마 전환** | ThemeToggle (우측 상단) | 없음 | 없음 |
| **네비게이션** | 키오스크, KDS 링크 | 없음 | 없음 |
| **멱등성 키** | `pos_temp_*` | `kiosk_temp_*` | `table_{id}_*` |
| **Shell 컴포넌트** | POSClientShell | KioskShell | TableOrderShell |

**공통 재사용 요소:**
- `useMenus()` — 메뉴 데이터 조회 + SSR hydration
- `useCart()` — 장바구니 상태 관리
- `useCreateOrder()` — 주문 생성 mutation
- `CategoryTabs` — 카테고리 탭 UI
- `Button` — 주문/결제 버튼

---

## 10. 데이터 흐름 다이어그램

### 메뉴 데이터 흐름

```
[백엔드 API]
    │
    ▼
GET /api/menus
    │
    ├─── 서버 측 (빌드/요청 시) ────────────────────────────┐
    │    getMenus() (server-api.ts)                         │
    │    ISR: 60초 revalidate                               │
    │    반환: MenuItem[]                                    │
    │                                                        │
    │    page.tsx (Server Component)                         │
    │    try { menus = await getMenus() }                   │
    │    catch { menus = [] }                                │
    │                                                        │
    │    <Shell initialMenus={menus} />                     │
    └───────────────────────────────────────────────────────┘
    │
    ├─── 클라이언트 측 (브라우저) ──────────────────────────┐
    │    Shell → useMenus(initialMenus)                     │
    │    React-Query: queryKey ["menus"]                     │
    │    initialData → 캐시에 즉시 저장                       │
    │    5초 후 → 백그라운드 리페치 (api.get)                │
    │    반환: { data: MenuItem[] }                          │
    │                                                        │
    │    CategoryTabs + MenuItem/MenuGrid                   │
    │    카테고리 필터링 → 렌더링                             │
    └───────────────────────────────────────────────────────┘
```

### 주문 생성 흐름

```
[사용자 인터랙션]
    │
    ▼
메뉴 클릭 → dispatch({ type: "ADD_ITEM", menu })
    │         CartProvider: items 추가, totalAmount 재계산
    │
    ▼
수량 조절 → dispatch({ type: "UPDATE_QUANTITY", menuId, quantity })
    │         CartProvider: 수량 변경 (0이면 삭제)
    │
    ▼
"결제하기" / "주문하기" 클릭
    │
    ▼
handleOrder()
    │
    ├── 1. CartItem[] → OrderItemCreate[] 변환
    ├── 2. 임시 멱등성 키 생성
    ├── 3. createOrder.mutate({items, idempotency_key, order_mode})
    │
    ▼
useCreateOrder (React-Query Mutation)
    │
    ├── onMutate: cancelQueries + 스냅샷 저장
    ├── mutationFn: POST /api/orders (Idempotency-Key 헤더)
    │
    ├── 성공 → onSuccess: invalidateQueries(["orders"])
    │          handleOrder onSuccess: dispatch({ type: "CLEAR" })
    │
    └── 실패 → onError: setQueryData(["orders"], previous) (롤백)
```

---

## 11. 파일 목록 총정리

### 신규 생성 (14개)

| # | 파일 경로 | 역할 | 라인 수 |
|---|-----------|------|---------|
| 1 | `src/hooks/useMenus.ts` | 메뉴 목록 쿼리 (SSR hydration) | 15 |
| 2 | `src/hooks/useOrders.ts` | 주문 목록 (3초 폴링) + 주문 상세 | 21 |
| 3 | `src/hooks/useCreateOrder.ts` | 주문 생성 mutation (낙관적 업데이트) | 35 |
| 4 | `src/components/common/Button.tsx` | 범용 버튼 (variant/size/fullWidth) | 52 |
| 5 | `src/components/common/ThemeToggle.tsx` | 라이트/다크 모드 토글 | 22 |
| 6 | `src/components/common/CategoryTabs.tsx` | 카테고리 탭 바 (즐겨찾기 옵션) | 78 |
| 7 | `src/components/common/OrderModeToggle.tsx` | 매장/포장 토글 | 49 |
| 8 | `src/components/pos/MenuItem.tsx` | 메뉴 카드 (카테고리 색상 코딩) | 84 |
| 9 | `src/components/pos/MenuGrid.tsx` | 메뉴 그리드 + CategoryTabs 연동 | 59 |
| 10 | `src/components/pos/CartItem.tsx` | 장바구니 항목 (수량 ±, 삭제) | 97 |
| 11 | `src/components/pos/Cart.tsx` | 장바구니 사이드바 (OrderModeToggle + 결제) | 107 |
| 12 | `src/components/pos/POSClientShell.tsx` | POS 전체 레이아웃 (2단 분할) | 80 |
| 13 | `src/components/kiosk/KioskShell.tsx` | 키오스크 전체 레이아웃 (768px) | 143 |
| 14 | `src/components/order/TableOrderShell.tsx` | 테이블오더 전체 레이아웃 (480px) | 155 |

### 수정 (3개)

| # | 파일 경로 | 변경 내용 |
|---|-----------|----------|
| 15 | `src/app/(pos)/page.tsx` | 스텁 → Server Component: getMenus() → POSClientShell |
| 16 | `src/app/kiosk/page.tsx` | 스텁 → Server Component: getMenus() → KioskShell |
| 17 | `src/app/order/[tableId]/page.tsx` | 스텁 → Server Component: getMenus() → TableOrderShell |

### 빌드 결과

```
Route (app)           Revalidate  Expire
┌ ○ /                         1m      1y    ← POS (ISR)
├ ○ /kiosk                    1m      1y    ← 키오스크 (ISR)
├ ƒ /order/[tableId]                        ← 테이블오더 (동적)
├ ○ /admin                                  ← (Phase 5에서 미변경)
├ ○ /admin/orders                           ← (Phase 5에서 미변경)
├ ○ /payment/fail                           ← (Phase 5에서 미변경)
└ ○ /payment/success                        ← (Phase 5에서 미변경)
```

---

## 다음 단계

> **Phase 6:** 백엔드 결제 API & Toss 연동
>
> Phase 5에서 POS/키오스크/테이블오더의 주문 생성까지 동작하므로, "결제하기" 이후의 결제 흐름을 위한 백엔드 API를 구축한다.
