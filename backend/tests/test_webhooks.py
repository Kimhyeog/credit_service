"""웹훅 API 테스트 — 4개 케이스"""

from unittest.mock import AsyncMock, patch
from app.config import settings
from app.db.client import db
from tests.test_orders import create_order


async def make_paid_order(client, menus, mock_toss, suffix):
    """헬퍼: PAID 상태 주문 + Payment 생성"""
    create_res = await create_order(client, menus, suffix)
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]
    pk = f"pk_wh_{suffix}"

    await client.post(
        "/api/payments/confirm",
        json={"payment_key": pk, "order_id": order_id, "amount": amount},
    )
    return order_id, pk


async def test_valid_webhook(client, menus, mock_toss):
    """유효한 웹훅 → Payment 상태 업데이트"""
    order_id, pk = await make_paid_order(client, menus, mock_toss, "wh_valid")

    with patch("app.services.webhook_service.toss_client") as wh_mock:
        wh_mock.get_payment = AsyncMock(return_value={
            "paymentKey": pk,
            "status": "CANCELED",
        })

        res = await client.post(
            "/api/webhooks/toss",
            json={
                "secret": settings.TOSS_WEBHOOK_SECRET,
                "eventType": "PAYMENT_STATUS_CHANGED",
                "data": {"paymentKey": pk, "status": "CANCELED"},
            },
        )

    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    # DB 확인
    payment = await db.payment.find_unique(where={"paymentKey": pk})
    assert payment.status == "CANCELED"


async def test_invalid_secret(client):
    """잘못된 시크릿 → 무시 (DB 변경 없음)"""
    res = await client.post(
        "/api/webhooks/toss",
        json={
            "secret": "wrong_secret",
            "eventType": "PAYMENT_STATUS_CHANGED",
            "data": {"paymentKey": "pk_any", "status": "DONE"},
        },
    )
    assert res.status_code == 200

    events = await db.webhookevent.find_many()
    assert len(events) == 0


async def test_duplicate_webhook(client, menus, mock_toss):
    """중복 웹훅 → 두 번째 무시"""
    order_id, pk = await make_paid_order(client, menus, mock_toss, "wh_dup")

    webhook_body = {
        "secret": settings.TOSS_WEBHOOK_SECRET,
        "eventType": "PAYMENT_STATUS_CHANGED",
        "data": {"paymentKey": pk, "status": "CANCELED"},
    }

    with patch("app.services.webhook_service.toss_client") as wh_mock:
        wh_mock.get_payment = AsyncMock(return_value={
            "paymentKey": pk,
            "status": "CANCELED",
        })
        await client.post("/api/webhooks/toss", json=webhook_body)
        await client.post("/api/webhooks/toss", json=webhook_body)

    events = await db.webhookevent.find_many(
        where={"paymentKey": pk, "eventType": "PAYMENT_STATUS_CHANGED"}
    )
    assert len(events) == 1


async def test_missing_payment_key(client):
    """paymentKey 누락 → 무시"""
    res = await client.post(
        "/api/webhooks/toss",
        json={
            "secret": settings.TOSS_WEBHOOK_SECRET,
            "eventType": "PAYMENT_STATUS_CHANGED",
            "data": {},
        },
    )
    assert res.status_code == 200

    events = await db.webhookevent.find_many()
    assert len(events) == 0
