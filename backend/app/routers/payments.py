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
