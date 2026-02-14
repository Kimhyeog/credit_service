import json
import logging
from datetime import datetime, timezone

from prisma import Prisma

from app.config import settings
from app.services.toss_client import toss_client

logger = logging.getLogger(__name__)

# Toss → Payment 상태 매핑
TOSS_TO_PAYMENT_STATUS: dict[str, str] = {
    "DONE": "DONE",
    "CANCELED": "CANCELED",
    "PARTIAL_CANCELED": "PARTIAL_CANCELED",
    "ABORTED": "ABORTED",
    "EXPIRED": "EXPIRED",
}

# Toss → Order 상태 매핑
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

        1. 시크릿 검증
        2. 중복 확인
        3. 이벤트 기록
        4. 이벤트 처리 (Toss API 재확인 포함)
        5. 완료 마킹

        항상 {"status": "ok"} 반환 — Toss 재시도 방지
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
            # 시크릿 검증을 이미 통과했으므로 계속 처리

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
