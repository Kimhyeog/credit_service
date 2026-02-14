# Phase 6. 백엔드 — 결제 API & Toss 연동

> **목표:** Toss Payments confirm API를 호출하는 HTTP 클라이언트 + 결제 서비스 + 결제 라우터 구현. 결제 승인/조회/취소 3개 엔드포인트 완성.
>
> **상태:** ✅ 완료
>
> **선행 조건:** Phase 3 완료 (주문 API가 동작하는 상태), Toss Payments 테스트 키 발급 완료

---

## 환경 설정

Toss Payments 개발자 센터(https://developers.tosspayments.com)에서 발급받은 **테스트 키**를 환경변수에 설정한다.

```bash
# backend/.env
DATABASE_URL="file:./dev.db"
TOSS_SECRET_KEY="test_sk_Poxy1XQL8RbkyDynGYW487nO5Wml"       # 시크릿 키 (서버 전용)
TOSS_WEBHOOK_SECRET="e1ec1365283bcbae1fa09619f1f6245a3901c96ce24332ad6b735609b1a7902f"
CORS_ORIGINS="http://localhost:3000"

# frontend/.env.local
NEXT_PUBLIC_API_URL="http://localhost:8000"
NEXT_PUBLIC_TOSS_CLIENT_KEY="test_ck_ALnQvDd2VJ6GMNGK0BzYVMj7X41m"  # 클라이언트 키 (공개)
NEXT_PUBLIC_PAYMENT_MOCK="false"                                       # 실제 Toss 결제 사용
```

**키 분리 원칙:**

```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│  Client Key (공개)            │     │  Secret Key (비밀)            │
│  test_ck_ALnQvDd2VJ...       │     │  test_sk_Poxy1XQL8R...       │
│                              │     │                              │
│  위치: frontend/.env.local   │     │  위치: backend/.env          │
│  용도: Toss 결제창 열기       │     │  용도: 결제 확정/취소/조회    │
│  노출: 브라우저에 노출 OK     │     │  노출: 절대 프론트엔드 ✗     │
└──────────────────────────────┘     └──────────────────────────────┘
```

> **⚠️ 보안:** `.env` 파일은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않는다.

---

## 왜 이 단계가 필요한가?

Phase 5에서 POS/키오스크/테이블오더의 **주문 생성**까지 구현했다. "결제하기" 버튼을 누르면 주문이 생성되지만, 아직 실제 **결제 승인**이 되지 않는다. 주문 상태가 `PENDING`에서 멈춰있다.

Toss Payments의 결제 흐름은 다음과 같다:

```
1. 프론트엔드에서 Toss 결제창 호출 (SDK) → 고객이 카드 정보 입력
2. Toss가 paymentKey를 발급하고 successUrl로 리다이렉트
3. 프론트엔드가 successUrl에서 paymentKey, orderId, amount를 서버로 전송
4. 서버가 Toss confirm API를 호출하여 결제 확정  ← 이 단계를 구현
5. 성공하면 Payment 레코드 생성, Order 상태를 PAID로 변경
```

**Step 4가 왜 서버에서 이루어져야 하는가?**

- Toss confirm API는 `Secret Key` (test_sk_...)로 인증한다
- Secret Key를 프론트엔드에 노출하면 **보안 사고** — 누구나 결제를 승인/취소 가능
- 따라서 서버가 중간에서 confirm을 호출하고, 그 결과를 DB에 기록한다

```
프론트엔드 (공개 키만 보유)          백엔드 (비밀 키 보유)
─────────────────────              ──────────────────
Toss SDK로 결제창 열기
  → paymentKey 받음
POST /api/payments/confirm         → Toss POST /v1/payments/confirm
  (paymentKey, orderId, amount)       (Basic Auth: test_sk_Poxy1XQL8R...)
  ← 결제 결과                      ← Toss 응답
```

---

## 구현 TODO

### Step 6-1. Toss HTTP 클라이언트

**파일:** `backend/app/services/toss_client.py`

Toss Payments REST API와 통신하는 HTTP 클라이언트. `httpx.AsyncClient`를 사용한다.

```python
import httpx
import base64
from app.config import settings

TOSS_BASE_URL = "https://api.tosspayments.com"


class TossClient:
    """
    Toss Payments API 클라이언트

    인증: Basic Auth — secret key를 base64 인코딩하여 Authorization 헤더에 포함
    형식: Basic base64("{SECRET_KEY}:")  ← 콜론 필수 (비밀번호 없음)
    """

    def __init__(self):
        secret = settings.TOSS_SECRET_KEY
        # Toss 인증 형식: "시크릿키:" 를 base64 인코딩
        encoded = base64.b64encode(f"{secret}:".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/json",
        }

    async def confirm_payment(
        self, payment_key: str, order_id: str, amount: int
    ) -> dict:
        """
        결제 승인 요청

        Toss API: POST /v1/payments/confirm
        - paymentKey: Toss가 발급한 결제 고유 키
        - orderId: 우리 서버의 주문 ID (Toss에 전달했던 값)
        - amount: 결제 금액 (원 단위)

        성공 시: 결제 정보 JSON 반환
        실패 시: httpx.HTTPStatusError 발생
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{TOSS_BASE_URL}/v1/payments/confirm",
                headers=self.headers,
                json={
                    "paymentKey": payment_key,
                    "orderId": order_id,
                    "amount": amount,
                },
                timeout=30.0,  # 결제 승인은 최대 30초 대기
            )
            response.raise_for_status()
            return response.json()

    async def get_payment(self, payment_key: str) -> dict:
        """
        결제 상태 조회

        Toss API: GET /v1/payments/{paymentKey}
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{TOSS_BASE_URL}/v1/payments/{payment_key}",
                headers=self.headers,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()

    async def cancel_payment(self, payment_key: str, reason: str) -> dict:
        """
        결제 취소 요청

        Toss API: POST /v1/payments/{paymentKey}/cancel
        - cancelReason: 취소 사유 (필수)
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{TOSS_BASE_URL}/v1/payments/{payment_key}/cancel",
                headers=self.headers,
                json={"cancelReason": reason},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()


# 모듈 레벨 인스턴스 (재사용)
toss_client = TossClient()
```

**왜 `httpx`를 사용하는가?**

- `requests`는 동기 전용 → FastAPI의 async 핸들러에서 쓰면 **이벤트 루프를 블로킹**
- `httpx`는 `async/await` 네이티브 지원 → FastAPI와 궁합이 좋음
- `aiohttp`도 가능하지만, `httpx`가 API가 더 직관적이고 `requests`와 유사

**왜 `async with httpx.AsyncClient()` 를 매번 생성하는가?**

- 요청마다 새 클라이언트를 만드는 것이 간단
- 커넥션 풀이 필요한 고트래픽 환경이면 `__init__`에서 클라이언트를 만들고 `__aenter__`/`__aexit__`로 관리하지만, POS 환경에서는 불필요

**Toss Basic Auth 인코딩 과정:**

```
설정된 키: test_sk_Poxy1XQL8RbkyDynGYW487nO5Wml

1. 키 뒤에 콜론(:) 붙이기 → "test_sk_Poxy1XQL8RbkyDynGYW487nO5Wml:"
2. base64 인코딩 → "dGVzdF9za19Qb3h5MVhRTDhSYmt5RHluR1lXNDg3bk81V21sOg=="
3. Authorization 헤더 → "Basic dGVzdF9za19Qb3h5MVhR..."
```

---

### Step 6-2. 결제 서비스

**파일:** `backend/app/services/payment_service.py`

결제 비즈니스 로직을 담당하는 서비스 클래스. Toss 클라이언트를 호출하고, 결과에 따라 DB를 업데이트한다.

```python
from fastapi import HTTPException
from prisma import Prisma
import httpx

from app.services.toss_client import toss_client


class PaymentService:
    def __init__(self, db: Prisma):
        self.db = db

    async def confirm(self, payment_key: str, order_id: str, amount: int):
        """
        결제 승인 처리

        1. 주문 조회 + 금액 검증
        2. Payment 레코드 생성 (status=IN_PROGRESS)
        3. Toss confirm API 호출
        4. 성공 → Payment DONE + Order PAID
        5. 실패 → Payment ABORTED + failReason 기록
        """
        # 1. 주문 조회 + 금액 검증
        order = await self.db.order.find_unique(where={"id": order_id})
        if not order:
            raise HTTPException(404, "Order not found")

        if order.totalAmount != amount:
            raise HTTPException(
                400,
                f"Amount mismatch: order={order.totalAmount}, request={amount}"
            )

        if order.status not in ["PENDING", "PAYMENT_PENDING"]:
            raise HTTPException(
                400,
                f"Order is not in payable status: {order.status}"
            )

        # 2. Payment 레코드 생성 또는 업데이트
        existing_payment = await self.db.payment.find_unique(
            where={"orderId": order_id}
        )

        if existing_payment:
            payment = await self.db.payment.update(
                where={"id": existing_payment.id},
                data={
                    "paymentKey": payment_key,
                    "status": "IN_PROGRESS",
                },
            )
        else:
            payment = await self.db.payment.create(
                data={
                    "paymentKey": payment_key,
                    "amount": amount,
                    "status": "IN_PROGRESS",
                    "orderId": order_id,
                },
            )

        # 주문 상태를 PAYMENT_PENDING으로 변경
        await self.db.order.update(
            where={"id": order_id},
            data={"status": "PAYMENT_PENDING"},
        )

        # 3. Toss confirm API 호출
        try:
            toss_response = await toss_client.confirm_payment(
                payment_key=payment_key,
                order_id=order_id,
                amount=amount,
            )

            # 4. 성공 → Payment DONE + Order PAID
            payment = await self.db.payment.update(
                where={"id": payment.id},
                data={
                    "status": "DONE",
                    "method": toss_response.get("method", None),
                    "approvedAt": toss_response.get("approvedAt", None),
                    "rawResponse": str(toss_response),
                },
            )

            await self.db.order.update(
                where={"id": order_id},
                data={"status": "PAID"},
            )

            return payment

        except httpx.HTTPStatusError as e:
            # 5. 실패 → Payment ABORTED
            error_body = e.response.json() if e.response.content else {}
            fail_reason = error_body.get("message", str(e))

            await self.db.payment.update(
                where={"id": payment.id},
                data={
                    "status": "ABORTED",
                    "failReason": fail_reason,
                    "rawResponse": str(error_body),
                },
            )

            await self.db.order.update(
                where={"id": order_id},
                data={"status": "FAILED"},
            )

            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Payment failed: {fail_reason}",
            )

    async def get_payment_by_order(self, order_id: str):
        """결제 상태 조회 — orderId 기준"""
        payment = await self.db.payment.find_unique(
            where={"orderId": order_id}
        )
        if not payment:
            raise HTTPException(404, "Payment not found for this order")
        return payment

    async def cancel(self, order_id: str, reason: str = "고객 요청 취소"):
        """
        결제 취소 처리

        1. Payment 조회 (paymentKey 필요)
        2. Toss cancel API 호출
        3. 성공 → Payment CANCELED + Order CANCELLED
        """
        payment = await self.db.payment.find_unique(
            where={"orderId": order_id}
        )
        if not payment:
            raise HTTPException(404, "Payment not found for this order")

        if payment.status != "DONE":
            raise HTTPException(
                400,
                f"Cannot cancel payment in {payment.status} status"
            )

        if not payment.paymentKey:
            raise HTTPException(400, "No payment key — cannot cancel via Toss")

        try:
            toss_response = await toss_client.cancel_payment(
                payment_key=payment.paymentKey,
                reason=reason,
            )

            payment = await self.db.payment.update(
                where={"id": payment.id},
                data={
                    "status": "CANCELED",
                    "rawResponse": str(toss_response),
                },
            )

            await self.db.order.update(
                where={"id": order_id},
                data={"status": "CANCELLED"},
            )

            return payment

        except httpx.HTTPStatusError as e:
            error_body = e.response.json() if e.response.content else {}
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Cancel failed: {error_body.get('message', str(e))}",
            )
```

**confirm 흐름의 핵심:**

```
요청: { payment_key: "pk_test_abc", order_id: "cuid123", amount: 14000 }

1. DB에서 주문 조회 → totalAmount=14000 확인 ✓
2. Payment 레코드 생성 (status=IN_PROGRESS)
3. Toss API 호출: POST /v1/payments/confirm
   Authorization: Basic dGVzdF9za19Qb3h5MVhR... (test_sk_Poxy... 인코딩)

   성공 시:
   ├── Payment → status=DONE, method="카드", approvedAt="2026-..."
   └── Order   → status=PAID

   실패 시:
   ├── Payment → status=ABORTED, failReason="잔액 부족"
   └── Order   → status=FAILED
```

**왜 금액 검증이 중요한가?**

```
공격 시나리오:
1. 고객이 14,000원 주문 생성
2. Toss 결제창에서 실제로 1원만 결제 시도 (amount 조작)
3. 서버의 confirm에서 amount=1로 요청

방어:
- confirm 시 order.totalAmount와 요청 amount를 비교
- 불일치하면 400 에러 → 결제 불허
```

---

### Step 6-3. 결제 라우터

**파일:** `backend/app/routers/payments.py`

```python
from fastapi import APIRouter
from app.db.client import get_db
from app.models.schemas import PaymentConfirmRequest, PaymentCancelRequest
from app.services.payment_service import PaymentService

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/confirm")
async def confirm_payment(body: PaymentConfirmRequest):
    """
    결제 승인 요청

    프론트엔드의 /payment/success 페이지에서 호출.
    Toss SDK가 리다이렉트한 paymentKey, orderId, amount를 받아서
    Toss confirm API를 호출하고 결과를 DB에 기록한다.
    """
    db = get_db()
    service = PaymentService(db)
    payment = await service.confirm(
        payment_key=body.payment_key,
        order_id=body.order_id,
        amount=body.amount,
    )
    return payment


@router.get("/{order_id}")
async def get_payment(order_id: str):
    """
    결제 상태 조회

    orderId 기준으로 Payment 레코드를 조회한다.
    프론트엔드에서 결제 진행 상태를 폴링할 때 사용.
    """
    db = get_db()
    service = PaymentService(db)
    return await service.get_payment_by_order(order_id)


@router.post("/{order_id}/cancel")
async def cancel_payment(order_id: str, body: PaymentCancelRequest = PaymentCancelRequest()):
    """
    결제 취소

    DONE 상태의 결제만 취소 가능.
    Toss cancel API를 호출하고 Payment/Order 상태를 업데이트한다.
    body 없이 호출 시 기본 사유 "고객 요청 취소" 적용.
    """
    db = get_db()
    service = PaymentService(db)
    return await service.cancel(order_id, reason=body.reason)
```

**엔드포인트 정리:**

| 메서드 | 경로 | 요청 | 설명 |
| ------ | -------------------------------- | ---------------------------------- | -------------- |
| `POST` | `/api/payments/confirm` | `PaymentConfirmRequest` body | Toss 결제 승인 |
| `GET` | `/api/payments/{orderId}` | path param | 결제 상태 조회 |
| `POST` | `/api/payments/{orderId}/cancel` | `PaymentCancelRequest` body (선택) | 결제 취소 |

---

### Step 6-4. main.py에 라우터 등록

**파일:** `backend/app/main.py`

기존 imports와 라우터 등록에 payments를 추가한다.

```python
from app.routers import menus, orders, payments  # payments 추가

# ... (기존 코드 유지)

app.include_router(menus.router)
app.include_router(orders.router)
app.include_router(payments.router)  # 추가
```

---

### Step 6-5. schemas.py에 취소 요청 스키마 추가

**파일:** `backend/app/models/schemas.py`

취소 시 사유를 받는 스키마를 추가한다. 기본값이 있으므로 body 없이 호출해도 동작한다.

```python
class PaymentCancelRequest(BaseModel):
    reason: str = "고객 요청 취소"
```

---

## 검증 체크리스트

### 1. 서버 실행 및 키 확인

```bash
cd backend && source venv/bin/activate
uvicorn app.main:app --reload

# 키가 정상 로드되는지 확인:
python -c "
from app.config import settings
print(f'Secret Key: {settings.TOSS_SECRET_KEY[:15]}...')
# → Secret Key: test_sk_Poxy1XQ...
"
```

### 2. 메뉴 조회 → 주문 생성 → 결제 상태 조회

```bash
# 메뉴 목록에서 실제 메뉴 ID 확인:
curl http://localhost:8000/api/menus | python -m json.tool
# → "id": "cmlm0qu7t00058ahyjieuc9g0", "name": "딸기스무디", "price": 6000 등

# 주문 생성 (실제 메뉴 ID 사용):
curl -X POST http://localhost:8000/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-pay-flow-002" \
  -d '{
    "items": [{"menu_id": "cmlm0qu7t00058ahyjieuc9g0", "quantity": 1}],
    "idempotency_key": "test-pay-flow-002"
  }'
# → 201 Created, id: "ord_xxx", totalAmount: 6000, status: "PENDING"

# 결제 상태 조회 (아직 Payment 없으므로 404 — 정상):
curl http://localhost:8000/api/payments/{위에서_받은_order_id}
# → 404 "Payment not found for this order"
```

### 3. API 문서 확인

```
http://localhost:8000/docs → payments 태그 아래 3개 엔드포인트 확인:
  POST /api/payments/confirm
  GET  /api/payments/{order_id}
  POST /api/payments/{order_id}/cancel
```

### 4. 실제 Toss 결제 확인은 Phase 7에서 수행

```
Phase 7 구현 후 E2E 테스트:
1. POS 화면에서 메뉴 선택 → "결제하기"
2. Toss 결제창 팝업 (test_ck_ALnQvDd2VJ... 클라이언트 키 사용)
3. 테스트 카드 입력:
   카드 번호: 4330-0000-0000-0880
   유효기간: 12/28 (미래 아무 날짜)
   CVC: 123 (아무 3자리)
4. 결제 완료 → /payment/success → POST /api/payments/confirm
5. 서버가 Toss confirm API 호출 (test_sk_Poxy... 시크릿 키 사용)
6. 성공 → Payment DONE, Order PAID
```

### 기대 결과

| 단계 | 요청 | 응답 | 설명 |
| ---- | ---- | ---- | ---- |
| 메뉴 조회 | `GET /api/menus` | `200 OK` | 시드 메뉴 8개 |
| 주문 생성 | `POST /api/orders` | `201 Created` | status: PENDING |
| 결제 조회 | `GET /api/payments/{orderId}` | `404 Not Found` | 아직 결제 미생성 — 정상 |
| 결제 승인 | `POST /api/payments/confirm` | `200 OK` / `4xx` | Phase 7에서 Toss SDK 연동 후 테스트 |
| 결제 취소 | `POST /api/payments/{orderId}/cancel` | `200 OK` / `400` | DONE 상태의 결제만 취소 가능 |

---

## 구현된 파일 정리

| # | 파일 | 유형 | 설명 |
|---|------|------|------|
| 1 | `backend/app/services/toss_client.py` | 신규 | Toss API HTTP 클라이언트 (Basic Auth) |
| 2 | `backend/app/services/payment_service.py` | 신규 | 결제 비즈니스 로직 (confirm/get/cancel) |
| 3 | `backend/app/routers/payments.py` | 신규 | 결제 라우터 3개 엔드포인트 |
| 4 | `backend/app/models/schemas.py` | 수정 | `PaymentCancelRequest` 스키마 추가 |
| 5 | `backend/app/main.py` | 수정 | payments 라우터 등록 |

---

## 다음 단계

→ **Phase 7**: 프론트엔드 결제 추상화 & 결제 플로우 페이지. Phase 6에서 만든 백엔드 결제 API를 프론트엔드에서 호출하는 Strategy 패턴 + 성공/실패 페이지를 구현한다. `NEXT_PUBLIC_PAYMENT_MOCK="false"` 설정으로 실제 Toss 결제창을 사용한다.
