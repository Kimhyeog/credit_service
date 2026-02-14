from fastapi import APIRouter, Header, Query
from app.db.client import get_db
from app.models.schemas import OrderCreate
from app.services.order_service import OrderService

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.post("", status_code=201)
async def create_order(
    body: OrderCreate,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    db = get_db()
    service = OrderService(db)
    order = await service.create_order(
        items=body.items,
        idempotency_key=body.idempotency_key,
    )
    return order


@router.get("")
async def list_orders(status: str | None = Query(None)):
    db = get_db()
    service = OrderService(db)
    return await service.get_orders(status=status)


@router.get("/{order_id}")
async def get_order(order_id: str):
    db = get_db()
    service = OrderService(db)
    return await service.get_order(order_id)


@router.patch("/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    db = get_db()
    service = OrderService(db)
    return await service.cancel_order(order_id)
