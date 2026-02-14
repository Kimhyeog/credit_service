# Provider 계층 학습 가이드

> `QueryProvider → ThemeProvider → CartProvider` 순서로 감싸는 이유,
> 각 Provider에서 사용한 React 패턴, 그로 인한 효과를 정리한다.

---

## 1. Provider란 무엇인가

**컴포넌트 트리 전체에 데이터를 공급하는 래퍼 컴포넌트**다.

```
Provider가 없으면 — props를 계속 전달해야 함 (Prop Drilling):

  Layout
    └── POSClientShell  (theme을 받아서)
          └── MenuGrid  (theme을 받아서)
                └── MenuItem  (theme을 써야 함)

  theme이 필요한 건 MenuItem뿐인데,
  Layout → POSClientShell → MenuGrid를 거쳐야 함


Provider가 있으면 — 어디서든 바로 접근:

  <ThemeProvider value={theme}>     ← 한 번 감싸면
    <Layout>
      <POSClientShell>
        <MenuGrid>
          <MenuItem />              ← useThemeMode()로 바로 접근
        </MenuGrid>
      </POSClientShell>
    </Layout>
  </ThemeProvider>
```

```
Prop Drilling:                    Provider:

Layout ──theme──→ Shell           <ThemeProvider>
                    │               Layout
               ──theme──→ Grid        Shell
                    │                   Grid
               ──theme──→ Item            Item ← useThemeMode() 직접 접근
                                  </ThemeProvider>
```

---

## 2. 왜 이 순서로 감싸는가

```typescript
<QueryProvider>           // 1️⃣ 가장 바깥
  <ThemeProvider>         // 2️⃣ 중간
    <CartProvider>        // 3️⃣ 가장 안쪽
      {children}          // 페이지 컴포넌트
    </CartProvider>
  </ThemeProvider>
</QueryProvider>
```

**규칙: 안쪽 Provider가 바깥쪽 Provider에 의존할 수 있다.**

```
의존 관계:

  QueryProvider ← ThemeProvider가 의존할 수 있음 (API로 테마 설정 fetch 등)
       ↑
  QueryProvider ← CartProvider가 의존 (useCreateOrder 등 mutation 사용)
       ↑
  ThemeProvider ← CartProvider가 의존할 수 있음 (장바구니 UI에 테마 필요)
```

만약 순서가 뒤집히면:

```typescript
// ❌ 잘못된 순서
<CartProvider>
  <QueryProvider>      ← CartProvider 안에 있음
    <ThemeProvider>
      {children}
    </ThemeProvider>
  </QueryProvider>
</CartProvider>

// CartProvider 안에서 useQuery를 쓰면?
// → QueryProvider가 아직 없으므로 에러!
// "No QueryClient set, use QueryClientProvider"
```

```
올바른 순서:                      잘못된 순서:

┌─ QueryProvider ──────────┐     ┌─ CartProvider ──────────┐
│  ┌─ ThemeProvider ─────┐ │     │  useQuery(...)          │
│  │  ┌─ CartProvider ─┐ │ │     │  → ❌ QueryClient 없음!  │
│  │  │  useQuery() ✅  │ │ │     │                         │
│  │  │  useTheme() ✅  │ │ │     │  ┌─ QueryProvider ───┐  │
│  │  └────────────────┘ │ │     │  │  (여기 있지만 늦음) │  │
│  └─────────────────────┘ │     │  └────────────────────┘  │
└──────────────────────────┘     └──────────────────────────┘
```

### 이 프로젝트에서의 실제 의존 관계

| Provider | 의존하는 대상 | 이유 |
|----------|-------------|------|
| QueryProvider | 없음 (독립) | React-Query는 다른 Provider 불필요 |
| ThemeProvider | 없음 (현재) | localStorage만 사용. 향후 서버에서 테마 설정 fetch 시 QueryProvider 필요 |
| CartProvider | QueryProvider (향후) | Phase 7에서 장바구니 → 주문 생성 시 useMutation 사용 |

→ QueryProvider가 가장 바깥이어야 안전하다.

---

## 3. QueryProvider — 각 패턴 설명

### 패턴: `useState`로 QueryClient 생성

```typescript
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ ... })
  );
  // ...
}
```

**왜 그냥 `new QueryClient()`가 아닌가:**

```typescript
// ❌ 나쁜 예 — 매 렌더마다 새 인스턴스
function QueryProvider({ children }) {
  const queryClient = new QueryClient();
  //                  ↑ 렌더링될 때마다 실행 → 매번 새 객체
  //                    → 캐시가 매번 초기화!
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

```
❌ 나쁜 예 — 렌더마다 새 인스턴스:

렌더 1: new QueryClient() → 캐시 { menus: [8개] }
렌더 2: new QueryClient() → 캐시 {}  ← 새 객체! 이전 캐시 소멸!
렌더 3: new QueryClient() → 캐시 {}  ← 또 새 객체!

  사용자가 페이지 이동할 때마다 메뉴를 다시 fetch해야 함
```

```typescript
// ✅ 좋은 예 — useState의 초기화 함수
function QueryProvider({ children }) {
  const [queryClient] = useState(
    () => new QueryClient()
    // ↑ 이 함수는 최초 렌더링 시 딱 한 번만 실행
  );
  // ...
}
```

```
✅ 좋은 예 — 한 번만 생성:

렌더 1: useState(() => new QueryClient()) → 캐시 { menus: [8개] }
렌더 2: 같은 queryClient 재사용           → 캐시 { menus: [8개] } 유지!
렌더 3: 같은 queryClient 재사용           → 캐시 { menus: [8개] } 유지!

  페이지 이동해도 캐시가 살아있음 → 즉시 표시 + 백그라운드 리페치
```

### 사례: 캐시 유지 효과

```
POS 메인 (/) 에서 메뉴 조회:
  api.get<MenuItem[]>("/api/menus") → 서버에서 fetch → 캐시에 저장

키오스크 (/kiosk) 로 이동:
  api.get<MenuItem[]>("/api/menus") → 캐시 히트! 즉시 표시
                                     (5초 이내면 서버 요청 안 함)

관리자 (/admin) 갔다가 POS (/) 로 복귀:
  api.get<MenuItem[]>("/api/menus") → 캐시 히트! 즉시 표시
```

```
캐시가 있을 때 (staleTime: 5초):

0초   메뉴 조회 → 서버 fetch → 캐시 저장
1초   페이지 이동 → 다시 조회 → 캐시에서 즉시 반환 (~1ms)
3초   또 이동 → 다시 조회 → 캐시에서 즉시 반환 (~1ms)
6초   또 이동 → 다시 조회 → 캐시 반환 + 백그라운드 리페치
                            (사용자는 기다리지 않음)

캐시가 없을 때 (매번 새 QueryClient):

0초   메뉴 조회 → 서버 fetch (150ms)
1초   페이지 이동 → 캐시 없음 → 서버 fetch (150ms)
3초   또 이동 → 캐시 없음 → 서버 fetch (150ms)
6초   또 이동 → 캐시 없음 → 서버 fetch (150ms)
```

### defaultOptions 각 값의 효과

```typescript
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,            // 5초
      gcTime: 10 * 60_000,         // 10분
      retry: 2,                    // 2회
      refetchOnWindowFocus: true,  // 탭 전환 시
    },
    mutations: {
      retry: 1,                    // 1회
    },
  },
});
```

```
staleTime: 5_000 (5초)
  "데이터를 5초 동안 '신선'하다고 간주"

  0초  fetch → 캐시 저장 [신선]
  3초  같은 쿼리 → 캐시 반환 (서버 요청 X) [아직 신선]
  6초  같은 쿼리 → 캐시 반환 + 백그라운드 리페치 [오래됨]


gcTime: 600_000 (10분)
  "사용하지 않는 캐시를 10분 후 삭제"

  0초   메뉴 조회 → 캐시 저장
  5분   다른 페이지에 있음 → 캐시 유지 (아직 10분 안 됨)
  11분  아직 다른 페이지 → 캐시 삭제 (10분 초과)
  12분  메뉴 페이지 복귀 → 캐시 없음 → 서버 fetch


retry: 2
  "실패 시 2회 재시도"

  시도 1: fetch → 500 에러
  시도 2: 1초 후 재시도 → 500 에러
  시도 3: 2초 후 재시도 → 200 성공! (또는 최종 실패)


refetchOnWindowFocus: true
  "브라우저 탭 전환 시 자동 리페치"

  직원이 POS 탭 → 카카오톡 탭 → POS 탭 복귀
  → 메뉴/주문 데이터 자동 리페치 → 최신 상태 보장
```

---

## 4. ThemeProvider — 각 패턴 설명

### 패턴: useEffect에서 localStorage 읽기

```typescript
const [mode, setMode] = useState<ThemeMode>("light");  // 기본값

useEffect(() => {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored) {
    setMode(stored);  // localStorage에 저장된 테마 적용
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    setMode("dark");  // OS 다크모드면 다크 테마
  }
}, []);
```

**왜 useState 초기값에서 바로 안 읽는가:**

```typescript
// ❌ 서버에서 에러 발생
const [mode, setMode] = useState<ThemeMode>(
  localStorage.getItem("theme") || "light"
  // ↑ 서버 렌더링 중에 실행됨 → localStorage가 없음 → 에러!
);

// ✅ useEffect는 클라이언트에서만 실행
useEffect(() => {
  const stored = localStorage.getItem("theme");
  // ↑ 브라우저에서만 실행 → 안전
}, []);
```

```
Next.js 렌더링 순서:

서버 (Node.js):
  1. page.tsx 실행
  2. layout.tsx 실행
  3. ThemeProvider 실행
     → useState("light") ← 기본값
     → useEffect는 실행 안 됨 (서버이므로)
  4. HTML 생성하여 브라우저에 전송

브라우저:
  5. HTML 수신 → 화면에 표시 (light 테마)
  6. React hydration 시작
  7. useEffect 실행
     → localStorage에서 "dark" 읽음
     → setMode("dark")
  8. 화면이 dark 테마로 전환 (잠깐 깜빡일 수 있음)
```

### 사례: 테마 전환과 지속성

```
사용자 A (처음 방문, macOS 다크모드):

  1. 페이지 로드 → light (기본값)
  2. useEffect → OS 다크모드 감지 → dark로 전환
  3. 토글 버튼 클릭 → light로 전환
     → localStorage에 "light" 저장
  4. 새로고침 → useEffect → localStorage에서 "light" 읽음
     → light 유지 ✅


사용자 B (재방문, 이전에 dark 선택):

  1. 페이지 로드 → light (기본값)
  2. useEffect → localStorage에서 "dark" 읽음 → dark로 전환
  3. 새로고침해도 dark 유지 ✅
```

### 패턴: Context + useThemeMode 커스텀 훅

```typescript
// Provider에서 Context 정의
const ThemeContext = createContext<ThemeContextValue>({ mode: "light", toggle: () => {} });

// 커스텀 훅으로 접근
export function useThemeMode() {
  return useContext(ThemeContext);
}
```

**사용하는 쪽:**

```typescript
// components/common/ThemeToggle.tsx
function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  //      ↑ "light" 또는 "dark"
  //             ↑ 클릭하면 전환하는 함수

  return (
    <button onClick={toggle}>
      {mode === "light" ? "🌙" : "☀️"}
    </button>
  );
}
```

```
ThemeToggle은 ThemeProvider 안에 있기만 하면 어디서든 동작:

<ThemeProvider>
  <Header>
    <ThemeToggle />        ← useThemeMode() 사용 ✅
  </Header>
  <Main>
    <POSClientShell>
      <ThemeToggle />      ← 여기서도 사용 가능 ✅
    </POSClientShell>
  </Main>
</ThemeProvider>
```

---

## 5. CartProvider — 각 패턴 설명

### 패턴: useReducer로 복합 상태 관리

**useState로 했다면:**

```typescript
// ❌ useState 3개 — 동기화 문제
const [items, setItems] = useState<CartItem[]>([]);
const [totalAmount, setTotalAmount] = useState(0);
const [orderMode, setOrderMode] = useState<OrderMode>("DINE_IN");

function addItem(menu: MenuItem) {
  setItems(prev => [...prev, { menu, quantity: 1 }]);
  setTotalAmount(prev => prev + menu.price);
  // → items와 totalAmount가 따로 업데이트됨
  // → 한 렌더 사이클에서 items는 업데이트됐는데 totalAmount는 아직 이전 값일 수 있음
}
```

```
useState 3개의 문제:

  addItem(아메리카노 4500원) 호출

  렌더 중간 상태:
    items: [아메리카노 x1]   ← 업데이트됨
    totalAmount: 0           ← 아직 이전 값!
    → UI에 "1개 | 0원"이 잠깐 보일 수 있음

  렌더 완료 후:
    items: [아메리카노 x1]
    totalAmount: 4500        ← 이제 업데이트됨
```

**useReducer로 하면:**

```typescript
// ✅ useReducer — 한 액션으로 모든 상태 동시 업데이트
function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const items = /* ... 아이템 추가 ... */;
      return {
        ...state,
        items,                          // items 업데이트
        totalAmount: calcTotal(items),  // totalAmount도 동시 업데이트
      };
      // → 하나의 return으로 items와 totalAmount가 항상 일치
    }
  }
}
```

```
useReducer의 동작:

  dispatch({ type: "ADD_ITEM", menu: 아메리카노 })

  reducer가 새 상태 객체를 한 번에 반환:
    {
      items: [아메리카노 x1],     ← 동시
      totalAmount: 4500,          ← 동시
      orderMode: "DINE_IN",      ← 유지
    }

  → 중간 불일치 상태가 없음
```

### 사례: 장바구니 전체 플로우

```
POS 화면에서의 장바구니 사용:

1. 아메리카노 클릭
   dispatch({ type: "ADD_ITEM", menu: 아메리카노 })
   → items: [아메리카노 x1], total: 4500

2. 아메리카노 또 클릭
   dispatch({ type: "ADD_ITEM", menu: 아메리카노 })
   → items: [아메리카노 x2], total: 9000
   (기존 아이템 quantity만 증가)

3. 카페라떼 클릭
   dispatch({ type: "ADD_ITEM", menu: 카페라떼 })
   → items: [아메리카노 x2, 카페라떼 x1], total: 14000

4. 포장 선택
   dispatch({ type: "SET_ORDER_MODE", mode: "TAKE_OUT" })
   → orderMode: "TAKE_OUT" (items, total 변경 없음)

5. 아메리카노 수량 1로 변경
   dispatch({ type: "UPDATE_QUANTITY", menuId: "...", quantity: 1 })
   → items: [아메리카노 x1, 카페라떼 x1], total: 9500

6. 카페라떼 수량 0으로 변경 (삭제)
   dispatch({ type: "UPDATE_QUANTITY", menuId: "...", quantity: 0 })
   → reducer 내부에서 REMOVE_ITEM으로 위임
   → items: [아메리카노 x1], total: 4500

7. 결제 완료 후
   dispatch({ type: "CLEAR" })
   → items: [], total: 0, orderMode: "DINE_IN" (유지 or 초기화)
```

### 사례: useCart 훅으로 컴포넌트에서 사용

```typescript
// components/pos/MenuGrid.tsx — 메뉴 클릭 시 장바구니에 추가
function MenuGrid({ menus }: { menus: MenuItem[] }) {
  const { dispatch } = useCart();

  return menus.map((menu) => (
    <MenuItem
      key={menu.id}
      menu={menu}
      onClick={() => dispatch({ type: "ADD_ITEM", menu })}
      //       ↑ 클릭 한 번으로 장바구니에 추가
    />
  ));
}

// components/pos/Cart.tsx — 장바구니 목록 표시
function Cart() {
  const { state, dispatch } = useCart();
  //     ↑ items, totalAmount, orderMode 전부 접근

  return (
    <div>
      <OrderModeToggle
        mode={state.orderMode}
        onChange={(mode) => dispatch({ type: "SET_ORDER_MODE", mode })}
      />

      {state.items.map((item) => (
        <CartItem
          key={item.menu.id}
          item={item}
          onQuantityChange={(qty) =>
            dispatch({ type: "UPDATE_QUANTITY", menuId: item.menu.id, quantity: qty })
          }
          onRemove={() =>
            dispatch({ type: "REMOVE_ITEM", menuId: item.menu.id })
          }
        />
      ))}

      <div>총 {state.items.length}개 | {state.totalAmount.toLocaleString()}원</div>
      <button onClick={handlePayment}>결제하기</button>
    </div>
  );
}
```

```
컴포넌트 관계:

<CartProvider>
  <POSClientShell>
    ┌────────────────┬──────────────┐
    │  MenuGrid      │  Cart        │
    │                │              │
    │  [아메리카노]   │  아메 x2     │
    │  [카페라떼]     │  카페 x1     │
    │  [바닐라라떼]   │              │
    │                │  [매장][포장] │
    │  onClick →     │  총 14,000원 │
    │  dispatch()    │  [결제하기]   │
    └────────────────┴──────────────┘
         │                  │
         │  같은 CartContext를 공유
         │                  │
         ▼                  ▼
    dispatch(ADD_ITEM)  state.items 읽기
    "아메리카노 추가"   "아메 x2, 카페 x1"
```

MenuGrid에서 `dispatch`하면, Cart가 자동으로 리렌더링되어 업데이트된 목록을 표시한다. 두 컴포넌트가 같은 CartContext를 공유하기 때문이다.

---

## 6. AppProviders — 왜 별도 파일로 분리하는가

### 분리하지 않으면:

```typescript
// app/layout.tsx — Provider를 직접 중첩
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <QueryProvider>
          <ThemeProvider>
            <CartProvider>
              {children}          ← 들여쓰기 4단계
            </CartProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
```

### 분리하면:

```typescript
// providers/AppProviders.tsx
export function AppProviders({ children }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <CartProvider>{children}</CartProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}

// app/layout.tsx — 깔끔
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
```

```
분리 효과:

1. layout.tsx가 깔끔해짐
2. Provider 추가/제거/순서 변경 → AppProviders.tsx 한 곳에서
3. 테스트 시 AppProviders를 그대로 감싸면 실제 환경과 동일
```

### 사례: 향후 Provider 추가 시

Phase 9에서 `RecoveryProvider`를 추가해야 할 때:

```typescript
// AppProviders.tsx만 수정
export function AppProviders({ children }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <CartProvider>
          <RecoveryProvider>       {/* ← 한 줄 추가 */}
            {children}
          </RecoveryProvider>
        </CartProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}

// layout.tsx는 수정 불필요!
```

---

## 7. 정리 — 패턴별 효과 요약

| Provider | 패턴 | 왜 이 패턴을 쓰는가 | 효과 |
|----------|------|-------------------|------|
| QueryProvider | `useState(() => new QueryClient())` | 매 렌더마다 캐시 초기화 방지 | 페이지 이동 후에도 캐시 유지 → 즉시 표시 |
| QueryProvider | `staleTime: 5000` | 5초 이내 동일 쿼리는 서버 요청 안 함 | 서버 부하 감소, 체감 속도 향상 |
| QueryProvider | `refetchOnWindowFocus` | 탭 전환 시 자동 리페치 | 직원이 다른 탭 갔다 오면 최신 데이터 |
| ThemeProvider | `useEffect + localStorage` | 서버에서 localStorage 접근 불가 | SSR 에러 방지 + 테마 영구 저장 |
| ThemeProvider | `window.matchMedia` | OS 다크모드 감지 | 첫 방문 시 OS 설정에 맞는 테마 |
| ThemeProvider | `Context + useThemeMode()` | 어디서든 테마 접근 가능 | 중첩 깊이와 무관하게 토글 가능 |
| CartProvider | `useReducer` | items + totalAmount + orderMode 동시 업데이트 | 상태 불일치 방지 |
| CartProvider | `dispatch(action)` | 액션 타입으로 의도 명확화 | "ADD_ITEM"이 무엇을 하는지 이름만 봐도 알 수 있음 |
| AppProviders | 합성 컴포넌트 | layout.tsx 간결화 | Provider 추가/순서 변경이 한 파일에서 해결 |
