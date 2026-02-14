# Phase 10. 웹훅 핸들러

> **목표:** Toss에서 결제 상태 변경 시 서버로 보내는 비동기 알림(webhook)을 수신하고, 시크릿 검증 → 중복 방지 → Toss API 재확인 → 상태 업데이트를 처리한다.
>
> **예상 소요:** 90~120분
>
> **선행 조건:** Phase 6 완료 (Payment API + Toss 연동), Phase 8 완료 (멱등성 미들웨어)

---

## 왜 이 단계가 필요한가?

Phase 6에서 구현한 결제 플로우는 **프론트엔드 → 서버 → Toss** 순서로 동기적으로 처리된다:

```
프론트: 결제하기 → Toss 결제창 → 성공 콜백 → POST /api/payments/confirm → DONE
```

이 플로우의 문제점:

```
문제 시나리오:
  1. confirm 요청 후 프론트엔드가 응답을 받기 전에 브라우저 닫힘
     → Toss에서는 결제 완료, 서버에서는 상태 업데이트 안 됨
     → Phase 9의 WAL 복구가 처리하지만, 서버 측 백업이 없음

  2. Toss에서 일정 시간 후 자동 취소 (EXPIRED)
     → 프론트엔드가 이미 닫힌 상태 → 서버 DB에 반영 안 됨
     → 관리자 대시보드에서 PAYMENT_PENDING인데 실제로는 만료

  3. 부분 취소 (PARTIAL_CANCELED)
     → Toss 대시보드에서 직접 처리 가능 → 서버에 알림 필요
```

**해결:** Toss가 결제 상태 변경 시 **웹훅(POST 요청)** 을 서버로 보냄.
서버는 이를 수신하여 DB 상태를 업데이트한다.

```
웹훅 플로우:

  Toss 내부에서 결제 상태 변경 발생
       │
       ▼
  Toss → POST /api/webhooks/toss (서버의 웹훅 엔드포인트)
       │
       ▼
  서버: 시크릿 검증 → 중복 확인 → Toss API 재확인 → DB 업데이트
       │
       ▼
  200 OK 응답 (Toss는 비-200 시 재시도함)
```

### 왜 웹훅만 믿지 않는가? (Toss API 재확인)

웹훅은 HTTP POST 요청이므로 **위조 가능**하다:

```
공격 시나리오:
  악의적 사용자가 /api/webhooks/toss 엔드포인트에 직접 POST 요청
  → { "eventType": "PAYMENT_STATUS_CHANGED", "data": { "status": "DONE" } }
  → 결제 없이 Order를 PAID로 변경 시도
```

방어 전략 — **이중 검증:**

```
1차: 시크릿 검증
  → body.secret === TOSS_WEBHOOK_SECRET
  → 시크릿을 모르면 요청 자체를 거부

2차: Toss API 재확인 (Defense in Depth)
  → toss_client.get_payment(paymentKey) 호출
  → Toss 서버에서 직접 반환한 status와 웹훅의 status 비교
  → 불일치 시 처리 거부
```

---

## Toss 웹훅 스펙

Toss가 서버로 보내는 웹훅의 형태:

```json
{
  "eventType": "PAYMENT_STATUS_CHANGED",
  "createdAt": "2026-02-15T12:00:00+09:00",
  "secret": "whsec_xxxxxxxx",
  "data": {
    "paymentKey": "pk_test_abc123",
    "orderId": "cm1234abc",
    "status": "DONE",
    "transactionKey": "tx_key_xxx"
  }
}
```

| 필드 | 설명 |
|------|------|
| `eventType` | 이벤트 종류. 현재는 `PAYMENT_STATUS_CHANGED`만 처리 |
| `createdAt` | 이벤트 발생 시각 (ISO 8601) |
| `secret` | Toss 대시보드에서 발급한 웹훅 시크릿. `settings.TOSS_WEBHOOK_SECRET`과 비교 |
| `data.paymentKey` | Toss 결제 고유 키 |
| `data.orderId` | 우리 서버의 주문 ID |
| `data.status` | 변경된 결제 상태 |

---

## 상태 매핑

Toss의 결제 상태가 변경되면, 서버의 Payment와 Order 상태를 함께 업데이트해야 한다.

```
Toss status        Payment status        Order status
─────────────      ──────────────        ────────────
DONE            →  DONE               →  PAID
CANCELED        →  CANCELED           →  CANCELLED
PARTIAL_CANCELED→  PARTIAL_CANCELED   →  CANCELLED
ABORTED         →  ABORTED            →  FAILED
EXPIRED         →  EXPIRED            →  FAILED
```

**이미 처리된 상태는 건너뛴다:**

```
현재 Payment.status === "DONE" 인데
웹훅에서 status: "DONE" 이 또 옴
→ 이미 처리됨 → skip (중복 웹훅)
```

---

## 처리 흐름 다이어그램

```
POST /api/webhooks/toss
  │
  ▼
┌──────────────────────┐
│  1. body 파싱 (JSON)  │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────────────┐
│  2. 시크릿 검증               │
│  body.secret === WEBHOOK_SEC? │
└──────┬───────────────────────┘
       │
       ├── NO → 200 OK 반환 (로그 경고, 재시도 방지)
       │
       ▼ YES
┌──────────────────────────────────────────┐
│  3. 중복 확인                              │
│  WebhookEvent에서 paymentKey + eventType   │
│  + processed=true 조회                     │
└──────┬───────────────────────────────────┘
       │
       ├── 이미 존재 → 200 OK 반환 (멱등)
       │
       ▼ 신규
┌──────────────────────────────────────────┐
│  4. WebhookEvent 레코드 생성              │
│  (processed=false, payload 전체 저장)     │
└──────┬───────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│  5. Toss API 재확인                       │
│  toss_client.get_payment(paymentKey)      │
│  → 실제 status와 웹훅 status 비교          │
└──────┬───────────────────────────────────┘
       │
       ├── 불일치 → processed=true 마킹 + 경고 로그
       │
       ▼ 일치
┌──────────────────────────────────────────┐
│  6. Payment + Order 상태 업데이트          │
│  → 상태 매핑 테이블에 따라 업데이트         │
└──────┬───────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│  7. processed=true, processedAt 기록      │
└──────┬───────────────────────────────────┘
       │
       ▼
  200 OK 반환
```

**중요: 항상 200 OK를 반환한다.** Toss는 비-200 응답 시 최대 5회 재시도하므로, 유효하지 않은 웹훅에도 200을 반환하여 무한 재시도를 방지한다.

---

## 구현 TODO

### Step 10-1. 웹훅 서비스

**파일:** `backend/app/services/webhook_service.py` (신규)

기존 `PaymentService`, `OrderService` 패턴과 동일하게 Prisma를 주입받는 서비스 클래스.

```python
import logging
from datetime import datetime, timezone
from prisma import Prisma
from app.config import settings
from app.services.toss_client import toss_client

logger = logging.getLogger(__name__)

# Toss → Payment/Order 상태 매핑
TOSS_TO_PAYMENT_STATUS: dict[str, str] = {
    "DONE": "DONE",
    "CANCELED": "CANCELED",
    "PARTIAL_CANCELED": "PARTIAL_CANCELED",
    "ABORTED": "ABORTED",
    "EXPIRED": "EXPIRED",
}

TOSS_TO_ORDER_STATUS: dict[str, str] = {
    "DONE": "PAID",
    "CANCELED": "CANCELLED",
    "PARTIAL_CANCELED": "CANCELLED",
    "ABORTED": "FAILED",
    "EXPIRED": "FAILED",
}


class WebhookService:
    def __init__(self, db: Prisma):
        self.db = db

    async def handle_toss_webhook(self, body: dict) -> dict:
        """
        Toss 웹훅 처리 메인 메서드

        Returns:
            {"status": "ok"} — 항상 성공 응답 (Toss 재시도 방지)
        """
        # 1. 시크릿 검증
        secret = body.get("secret", "")
        if secret != settings.TOSS_WEBHOOK_SECRET:
            logger.warning("Webhook secret mismatch")
            return {"status": "ok"}

        event_type = body.get("eventType", "")
        data = body.get("data", {})
        payment_key = data.get("paymentKey", "")

        if not payment_key:
            logger.warning("Webhook missing paymentKey")
            return {"status": "ok"}

        # 2. 중복 확인
        existing = await self.db.webhookevent.find_first(
            where={
                "paymentKey": payment_key,
                "eventType": event_type,
                "processed": True,
            }
        )
        if existing:
            logger.info(f"Duplicate webhook: {payment_key}/{event_type}")
            return {"status": "ok"}

        # 3. 이벤트 기록 (processed=false)
        import json
        event_record = await self.db.webhookevent.create(
            data={
                "eventType": event_type,
                "paymentKey": payment_key,
                "payload": json.dumps(body, ensure_ascii=False),
                "processed": False,
            }
        )

        # 4. 이벤트 처리
        try:
            if event_type == "PAYMENT_STATUS_CHANGED":
                await self._handle_status_changed(data)
        except Exception as e:
            logger.error(f"Webhook processing error: {e}")

        # 5. 완료 마킹
        await self.db.webhookevent.update(
            where={"id": event_record.id},
            data={
                "processed": True,
                "processedAt": datetime.now(timezone.utc),
            },
        )

        return {"status": "ok"}

    async def _handle_status_changed(self, data: dict) -> None:
        """PAYMENT_STATUS_CHANGED 이벤트 처리"""
        payment_key = data.get("paymentKey", "")
        webhook_status = data.get("status", "")

        if webhook_status not in TOSS_TO_PAYMENT_STATUS:
            logger.warning(f"Unknown Toss status: {webhook_status}")
            return

        # Toss API 재확인 (Defense in Depth)
        try:
            toss_payment = await toss_client.get_payment(payment_key)
            actual_status = toss_payment.get("status", "")

            if actual_status != webhook_status:
                logger.warning(
                    f"Status mismatch: webhook={webhook_status}, "
                    f"toss_api={actual_status}"
                )
                return
        except Exception as e:
            logger.error(f"Toss API verification failed: {e}")
            # API 확인 실패 시에도 웹훅은 처리 (시크릿 검증을 이미 통과했으므로)
            # 단, 프로덕션에서는 정책에 따라 거부할 수도 있음

        # Payment 조회
        payment = await self.db.payment.find_unique(
            where={"paymentKey": payment_key}
        )
        if not payment:
            logger.warning(f"Payment not found: {payment_key}")
            return

        # 이미 같은 상태이면 스킵
        new_payment_status = TOSS_TO_PAYMENT_STATUS[webhook_status]
        if payment.status == new_payment_status:
            logger.info(f"Payment already in {new_payment_status}")
            return

        # Payment 상태 업데이트
        await self.db.payment.update(
            where={"id": payment.id},
            data={"status": new_payment_status},
        )

        # Order 상태 업데이트
        new_order_status = TOSS_TO_ORDER_STATUS[webhook_status]
        await self.db.order.update(
            where={"id": payment.orderId},
            data={"status": new_order_status},
        )

        logger.info(
            f"Webhook processed: {payment_key} → "
            f"Payment={new_payment_status}, Order={new_order_status}"
        )
```

**왜 서비스 클래스로 분리하는가?**

```
현재 코드 패턴:
  routers/orders.py   → OrderService(db)    ← 비즈니스 로직
  routers/payments.py → PaymentService(db)   ← 비즈니스 로직
  routers/webhooks.py → WebhookService(db)   ← 비즈니스 로직  ✓ 일관성

라우터 안에 직접 로직:
  routers/webhooks.py → 라우터에 DB 쿼리 + 비즈니스 로직 혼재  ✗ 불일관
```

서비스 분리의 이점:
- **테스트 용이:** `WebhookService(mock_db)`로 DB를 모킹하여 단위 테스트 가능
- **재사용:** 나중에 수동 웹훅 재처리 API가 필요하면 동일 서비스 호출
- **SRP:** 라우터는 HTTP 계층만, 서비스는 비즈니스 로직만

---

### Step 10-2. 웹훅 라우터

**파일:** `backend/app/routers/webhooks.py` (신규)

```python
from fastapi import APIRouter, Request
from app.db.client import get_db
from app.services.webhook_service import WebhookService

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@router.post("/toss")
async def toss_webhook(request: Request):
    """
    Toss 웹훅 수신 엔드포인트

    Toss가 결제 상태 변경 시 이 엔드포인트로 POST 요청을 보낸다.
    항상 200 OK를 반환하여 Toss의 재시도를 방지한다.
    """
    body = await request.json()

    db = get_db()
    service = WebhookService(db)
    result = await service.handle_toss_webhook(body)

    return result
```

**왜 Pydantic 모델 대신 `Request.json()`을 쓰는가?**

```
Pydantic 사용 시:
  class TossWebhookBody(BaseModel):
      eventType: str
      createdAt: str
      secret: str
      data: dict

  → Toss가 나중에 새 필드를 추가하면?
  → Pydantic strict 모드에서 에러 → 웹훅 수신 실패
  → Toss가 재시도 → 반복 실패

Request.json() 사용 시:
  body = await request.json()  # dict — 어떤 필드가 와도 OK
  → 유연한 처리, 원본 payload를 그대로 WebhookEvent에 저장
  → 새 필드 추가되어도 문제없음
```

웹훅 엔드포인트는 **외부 서비스가 보내는 요청**이므로, 스키마 변경에 유연하게 대응해야 한다. 요청 본문 전체를 `payload`에 저장하여 디버깅에도 활용한다.

---

### Step 10-3. main.py에 라우터 등록

**파일:** `backend/app/main.py` (수정)

```python
from app.routers import menus, orders, payments, webhooks

# (기존 라우터 등록 아래에 추가)
app.include_router(webhooks.router)
```

**주의: 웹훅 엔드포인트는 멱등성 미들웨어를 통과하지만 문제없다.**

현재 `IdempotencyMiddleware`는 `Idempotency-Key` 헤더가 있는 POST만 처리한다. Toss 웹훅 요청에는 이 헤더가 없으므로 미들웨어를 그대로 통과한다 (`idem_key = None → return await call_next(request)`).

---

### Step 10-4. 검증

#### 테스트 1: 시크릿 불일치 → 무시 (200 OK)

```bash
curl -s -X POST http://localhost:8000/api/webhooks/toss \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "PAYMENT_STATUS_CHANGED",
    "createdAt": "2026-02-15T12:00:00+09:00",
    "secret": "wrong_secret",
    "data": {
      "paymentKey": "pk_test_xxx",
      "orderId": "order_xxx",
      "status": "DONE"
    }
  }'
# 기대: {"status":"ok"} (처리 안 됨, 서버 로그에 warning)
```

#### 테스트 2: 정상 웹훅 → Payment/Order 상태 업데이트

실제 Toss 테스트 키 환경에서 결제를 완료한 후:

```bash
# 1. 먼저 결제 완료된 주문의 paymentKey 확인
curl -s http://localhost:8000/api/payments/<order_id> | python -m json.tool

# 2. 웹훅 시뮬레이션 (실제 시크릿 사용)
curl -s -X POST http://localhost:8000/api/webhooks/toss \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "PAYMENT_STATUS_CHANGED",
    "createdAt": "2026-02-15T12:00:00+09:00",
    "secret": "<TOSS_WEBHOOK_SECRET 값>",
    "data": {
      "paymentKey": "<실제 paymentKey>",
      "orderId": "<실제 orderId>",
      "status": "CANCELED"
    }
  }'
# 기대: {"status":"ok"}
# Payment.status → CANCELED, Order.status → CANCELLED
```

#### 테스트 3: 중복 웹훅 → 멱등 처리 (200 OK)

```bash
# 같은 웹훅을 2번 전송
# 기대: 첫 번째 → 처리, 두 번째 → "Duplicate webhook" 로그 + 스킵
```

#### 테스트 4: 빌드 검증

```bash
cd backend
python -c "from app.routers.webhooks import router; print('OK')"
python -c "from app.services.webhook_service import WebhookService; print('OK')"
```

---

## 구현할 파일 정리

| # | 파일 | 유형 | 설명 |
|---|------|------|------|
| 1 | `backend/app/services/webhook_service.py` | 신규 | 웹훅 비즈니스 로직 — 시크릿 검증, 중복 방지, Toss API 재확인, 상태 업데이트 |
| 2 | `backend/app/routers/webhooks.py` | 신규 | POST /api/webhooks/toss 라우터 |
| 3 | `backend/app/main.py` | 수정 | `webhooks.router` 등록 |

---

## 기존 코드 활용

| 사용할 것 | 위치 | 용도 |
|-----------|------|------|
| `get_db()` | `app/db/client.py` | Prisma 인스턴스 가져오기 |
| `settings.TOSS_WEBHOOK_SECRET` | `app/config.py` | 시크릿 검증 |
| `toss_client.get_payment()` | `app/services/toss_client.py` | Toss API로 결제 상태 재확인 |
| `WebhookEvent` 모델 | `prisma/schema.prisma` | 이벤트 기록 + 중복 방지 |
| `Payment` 모델 | `prisma/schema.prisma` | `paymentKey`로 조회 → 상태 업데이트 |
| `Order` 모델 | `prisma/schema.prisma` | `payment.orderId`로 주문 상태 업데이트 |

---

## 구현 순서

1. **`webhook_service.py` 생성** — 비즈니스 로직 전체 (시크릿 검증, 중복 확인, Toss API 재확인, 상태 업데이트)
2. **`webhooks.py` 라우터 생성** — HTTP 엔드포인트
3. **`main.py` 수정** — 라우터 등록
4. **검증** — curl로 시크릿 불일치/정상/중복 테스트

---

## 다음 단계

→ **Phase 11**: 관리자 대시보드 고도화 & KDS. 주문 목록 필터, 주문 상세 모달, 매출 요약, KDS 칸반 보드를 구현한다.
