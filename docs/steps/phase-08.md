# Phase 8. 멱등성 보장 (프론트 + 백)

> **목표:** 동일 요청의 중복 처리 방지 — 프론트엔드에서 키 생성, 백엔드에서 응답 캐싱. 네트워크 재시도, 더블 클릭, 브라우저 새로고침 등에서 중복 주문/결제를 방지한다.
>
> **예상 소요:** 90~120분
>
> **선행 조건:** Phase 7 완료 (결제 플로우가 동작하는 상태), Prisma `IdempotencyRecord` 모델이 schema.prisma에 이미 정의됨

---

## 왜 이 단계가 필요한가?

Phase 7까지의 결제 플로우에서는 "결제하기" 버튼을 누를 때마다 **임시 키**(`pos_temp_${Date.now()}_${random}`)를 생성한다. 이 키는 매번 달라지므로, 동일한 주문에 대해 두 번 요청하면 **중복 주문이 생성**된다.

```
문제 시나리오:

1. 고객이 "결제하기" 클릭
2. 네트워크 지연으로 응답이 안 옴
3. 고객이 다시 "결제하기" 클릭
4. 두 요청 모두 서버에 도착 → 주문 2개 생성 → 결제 2건 처리 ✗

멱등성 보장 후:

1. 고객이 "결제하기" 클릭 (키: pos_a1b2c3_1707900000_x8k2m)
2. 네트워크 지연으로 응답이 안 옴
3. 고객이 다시 "결제하기" 클릭 (동일 키 재사용)
4. 두 번째 요청 → 미들웨어가 키 발견 → 저장된 첫 번째 응답 반환 ✓
```

### 멱등성 키의 3가지 구성 요소

```
pos_a1b2c3_1707900000_x8k2m
 │    │        │        │
 │    │        │        └── random: UUID 8자리 (충돌 방지)
 │    │        └── timestamp: 초 단위 (시간 순서 보장)
 │    └── hash: 장바구니 내용의 djb2 해시 (동일 내용 → 동일 해시)
 └── prefix: 출처 구분 (pos / kiosk / table)
```

**왜 장바구니 해시를 포함하는가?**

- 같은 고객이 같은 메뉴를 주문하더라도, 타임스탬프와 랜덤 값이 다르면 다른 키가 됨
- 반대로, 네트워크 재시도 시에는 동일 키가 유지되어 중복 방지
- 해시는 "같은 장바구니 = 같은 주문 의도"라는 시맨틱을 표현

### 프론트엔드 vs 백엔드 역할 분리

```
프론트엔드 (키 생성 + 전송)            백엔드 (키 검증 + 응답 캐싱)
──────────────────────              ─────────────────────────
generateIdempotencyKey(items)       IdempotencyMiddleware
  │                                   │
  │ POST /api/orders                  ├─ Idempotency-Key 헤더 확인
  │ Header: Idempotency-Key: ...      │
  │ Body: { idempotency_key: ... }    ├─ DB에서 키 조회
  │                                   │  ├─ 존재 + 미만료 → 저장된 응답 반환
  │                                   │  ├─ 존재 + 만료 → 레코드 삭제 → 핸들러 실행
  │                                   │  └─ 미존재 → 핸들러 실행 → 응답 저장
  │                                   │
  ◄── 201 Created ─────────────────────
```

---

## 구현 TODO

### Step 8-1. 프론트엔드 — 멱등성 키 생성 유틸

**파일:** `frontend/src/utils/idempotency.ts` (신규)

장바구니 내용을 기반으로 멱등성 키를 생성하는 유틸리티 함수.

```typescript
/**
 * 멱등성 키 생성
 *
 * 같은 장바구니 내용 + 같은 시간대 → 유사한 키 (타임스탬프 + 해시)
 * 하지만 random 부분이 다르므로 실제로는 매번 고유
 * → 결제 플로우 동안은 useIdempotencyKey 훅으로 동일 키 유지
 */
export function generateIdempotencyKey(
  items: { menuId: string; quantity: number }[]
): string {
  // 장바구니 내용을 정렬 + 직렬화 → 해시
  const payload = items
    .map((i) => `${i.menuId}:${i.quantity}`)
    .sort()
    .join("|");
  const timestamp = Math.floor(Date.now() / 1000);
  const random = crypto.randomUUID().slice(0, 8);
  return `pos_${simpleHash(payload)}_${timestamp}_${random}`;
}

/**
 * djb2 해시 함수
 *
 * 암호학적 해시가 아닌 간단한 핑거프린팅용.
 * 장바구니 내용이 같으면 같은 해시, 다르면 높은 확률로 다른 해시.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
```

**djb2 해시가 충분한 이유:**

- 멱등성 키의 유니크성은 `timestamp + random`이 보장
- 해시는 "같은 장바구니인지" 시맨틱 구분용
- SHA-256 같은 무거운 해시는 POS 환경에서 과잉

---

### Step 8-2. 프론트엔드 — useIdempotencyKey 훅

**파일:** `frontend/src/hooks/useIdempotencyKey.ts` (신규)

결제 플로우 동안 동일한 멱등성 키를 유지하는 훅. "결제하기" → 주문 생성 → 결제 완료까지 같은 키를 사용하고, 새 주문 시작 시 `reset()`으로 키를 초기화한다.

```typescript
import { useRef, useCallback } from "react";
import { generateIdempotencyKey } from "@/utils/idempotency";

/**
 * 결제 플로우 동안 단일 멱등성 키를 유지하는 훅
 *
 * - getKey(): 현재 키 반환 (없으면 새로 생성)
 * - reset(): 키 초기화 (새 주문 시작 시)
 *
 * useRef를 사용하므로 리렌더링과 무관하게 키가 유지된다.
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

**왜 `useRef`인가?**

```
useState → 키 변경 시 리렌더링 발생 → 불필요
useMemo  → 의존성 변경 시 키가 바뀜 → 재시도 시 새 키가 되어 멱등성 깨짐
useRef   → 리렌더링 없이 값 유지, 명시적 reset만 가능 → ✓
```

---

### Step 8-3. 프론트엔드 — Shell 컴포넌트에 멱등성 키 적용

**변경 파일:** `Cart.tsx`, `KioskShell.tsx`, `TableOrderShell.tsx`

현재 각 Shell에서 임시 키를 사용하는 부분:

```typescript
// 현재 (Phase 7):
const idempotencyKey = `pos_temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
```

이것을 `generateIdempotencyKey()`로 교체한다:

```typescript
// Phase 8 이후:
import { generateIdempotencyKey } from "@/utils/idempotency";

const idempotencyKey = generateIdempotencyKey(
  state.items.map((item) => ({
    menuId: item.menu.id,
    quantity: item.quantity,
  }))
);
```

각 Shell의 prefix를 유지하려면 `generateIdempotencyKey` 내부의 `pos_` 대신 출처 인자를 받도록 확장할 수도 있다. 하지만 멱등성 키의 유니크성은 timestamp + random이 보장하므로, prefix 구분은 선택사항이다.

---

### Step 8-4. 백엔드 — 멱등성 미들웨어

**파일:** `backend/app/middleware/idempotency.py` (신규)

POST/PATCH 요청에 `Idempotency-Key` 헤더가 있으면, 동일 키의 재요청에 대해 핸들러를 재실행하지 않고 저장된 응답을 반환한다.

```python
import json
from datetime import datetime, timedelta
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from app.db.client import get_db


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    Idempotency-Key 헤더가 있는 POST/PATCH 요청에 대해
    동일한 키로 재요청이 오면 저장된 응답을 반환한다.

    흐름:
    1. POST/PATCH + Idempotency-Key 헤더 → 미들웨어 작동
    2. GET/DELETE, 헤더 없음 → 바로 통과
    3. DB에서 키 조회:
       - 존재 + 미만료 → 저장된 응답 반환 (핸들러 실행 안 함)
       - 존재 + 만료   → 레코드 삭제 → 핸들러 실행 → 새 응답 저장
       - 미존재        → 핸들러 실행 → 응답을 IdempotencyRecord에 저장 (TTL 24시간)
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
                # 만료된 레코드 → 아래에서 핸들러 실행
            else:
                # 저장된 응답 반환 (핸들러 실행 안 함)
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

**왜 응답 본문을 다시 읽는가?**

```
Starlette의 StreamingResponse는 body를 한 번만 읽을 수 있다.
미들웨어에서 body를 소비한 후, 새 Response 객체를 만들어 반환해야 한다.

original response (body_iterator)
  │
  ├── async for chunk → body 수집
  │
  └── 새 Response(content=body, ...) → 클라이언트에 반환
       └── body를 DB에도 저장 (재요청 시 사용)
```

**Prisma `IdempotencyRecord` 모델 (이미 schema.prisma에 정의됨):**

```prisma
model IdempotencyRecord {
  id             String   @id @default(cuid())
  idempotencyKey String   @unique
  httpMethod     String
  path           String
  statusCode     Int
  responseBody   String
  expiresAt      DateTime
  createdAt      DateTime @default(now())
}
```

---

### Step 8-5. main.py에 미들웨어 등록

**파일:** `backend/app/main.py` (수정)

```python
from app.middleware.idempotency import IdempotencyMiddleware

# CORS 미들웨어 다음에 등록 (순서 중요)
app.add_middleware(IdempotencyMiddleware)
```

**미들웨어 실행 순서:**

```
요청 → CORS → IdempotencyMiddleware → 라우터 핸들러
응답 ← CORS ← IdempotencyMiddleware ← 라우터 핸들러

CORS가 먼저 처리되어야 프리플라이트(OPTIONS) 요청이
멱등성 미들웨어에 도달하지 않는다.
```

> **주의:** Starlette 미들웨어는 `add_middleware()` 호출 순서의 **역순**으로 실행된다. 즉, 마지막에 등록한 미들웨어가 가장 먼저 실행된다. CORS를 `add_middleware`로 먼저 등록하고, Idempotency를 그 다음에 등록하면, 요청은 Idempotency → CORS 순서로 통과한다. 이 점을 고려하여 등록 순서를 결정한다.

---

## 검증 체크리스트

### 1. 멱등성 키 생성 확인

```bash
# 브라우저 DevTools → Console
# POS 화면에서 장바구니에 메뉴 추가 후:
# "결제하기" 클릭 시 Network 탭에서
# POST /api/orders 요청 헤더에 Idempotency-Key 확인
# 예: Idempotency-Key: pos_a1b2c3_1707900000_x8k2m
```

### 2. 동일 키 재전송 테스트 (curl)

```bash
# 첫 번째 요청:
curl -X POST http://localhost:8000/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-idem-001" \
  -d '{
    "items": [{"menu_id": "<MENU_ID>", "quantity": 1}],
    "idempotency_key": "test-idem-001"
  }'
# → 201 Created, 새 주문 생성

# 두 번째 요청 (동일 키):
curl -X POST http://localhost:8000/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-idem-001" \
  -d '{
    "items": [{"menu_id": "<MENU_ID>", "quantity": 1}],
    "idempotency_key": "test-idem-001"
  }'
# → 201 Created, 첫 번째와 동일한 응답 (새 주문 생성 안 됨)

# 주문 목록 확인:
curl http://localhost:8000/api/orders | python -m json.tool
# → 주문 1개만 존재 (중복 없음)
```

### 3. 만료 키 테스트

```bash
# TTL_HOURS = 24 이므로 직접 테스트하기 어려움
# 개발 시 TTL_HOURS를 임시로 낮춰서 테스트하거나,
# DB에서 직접 expiresAt을 과거로 수정 후 재요청
```

### 4. 빌드 검증

```bash
cd frontend && npm run build    # 타입 + 빌드 에러 없음
cd backend && uvicorn app.main:app --reload  # 미들웨어 등록 에러 없음
```

### 기대 결과

| 시나리오 | 요청 | 결과 |
|---------|------|------|
| 첫 번째 요청 | `Idempotency-Key: abc` | 핸들러 실행 → 응답 저장 → 반환 |
| 동일 키 재요청 (미만료) | `Idempotency-Key: abc` | 저장된 응답 반환 (핸들러 미실행) |
| 동일 키 재요청 (만료) | `Idempotency-Key: abc` | 레코드 삭제 → 핸들러 재실행 |
| 키 없는 요청 | (헤더 없음) | 미들웨어 무시 → 핸들러 정상 실행 |
| GET 요청 | `Idempotency-Key: abc` | 미들웨어 무시 → GET은 멱등성 대상 아님 |

---

## 구현할 파일 정리

| # | 파일 | 유형 | 설명 |
|---|------|------|------|
| 1 | `frontend/src/utils/idempotency.ts` | 신규 | 멱등성 키 생성 유틸 (djb2 해시 + timestamp + random) |
| 2 | `frontend/src/hooks/useIdempotencyKey.ts` | 신규 | 결제 플로우 동안 단일 키 유지 훅 |
| 3 | `frontend/src/components/pos/Cart.tsx` | 수정 | 임시 키 → `generateIdempotencyKey()` 교체 |
| 4 | `frontend/src/components/kiosk/KioskShell.tsx` | 수정 | 임시 키 → `generateIdempotencyKey()` 교체 |
| 5 | `frontend/src/components/order/TableOrderShell.tsx` | 수정 | 임시 키 → `generateIdempotencyKey()` 교체 |
| 6 | `backend/app/middleware/idempotency.py` | 신규 | 멱등성 미들웨어 (응답 캐싱 + TTL) |
| 7 | `backend/app/main.py` | 수정 | 미들웨어 등록 |

---

## 다음 단계

→ **Phase 9**: 결제 상태 머신 & WAL & 자동 복구. 멱등성으로 "중복 처리"를 방지했지만, 브라우저 크래시나 네트워크 장애로 결제 플로우가 **중간에 끊기는 경우**는 별도 처리가 필요하다. WAL(Write-Ahead Log)에 결제 인텐트를 기록하고, 앱 재로드 시 자동으로 복구한다.
