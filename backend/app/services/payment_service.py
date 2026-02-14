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
