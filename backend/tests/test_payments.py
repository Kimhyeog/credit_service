"""결제 API 테스트 — 5개 케이스 (Toss API mock)"""

from tests.test_orders import create_order, make_idempotency_key


async def test_confirm_success(client, menus, mock_toss):
    """결제 승인 — Payment DONE, Order PAID"""
    create_res = await create_order(client, menus, "pay_ok")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    res = await client.post(
        "/api/payments/confirm",
        json={
            "payment_key": "pk_success",
            "order_id": order_id,
            "amount": amount,
        },
    )
    assert res.status_code == 200
    assert res.json()["status"] == "DONE"

    # Order가 PAID로 변경되었는지 확인
    order_res = await client.get(f"/api/orders/{order_id}")
    assert order_res.json()["status"] == "PAID"


async def test_confirm_amount_mismatch(client, menus, mock_toss):
    """결제 승인 — 금액 불일치 → 400"""
    create_res = await create_order(client, menus, "pay_mismatch")
    order_id = create_res.json()["id"]

    res = await client.post(
        "/api/payments/confirm",
        json={
            "payment_key": "pk_mismatch",
            "order_id": order_id,
            "amount": 99999,
        },
    )
    assert res.status_code == 400
    assert "일치" in res.json()["detail"]


async def test_confirm_already_paid(client, menus, mock_toss):
    """이미 PAID인 주문에 재 confirm → 400"""
    create_res = await create_order(client, menus, "pay_dup")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    # 1차 confirm
    await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_dup_1", "order_id": order_id, "amount": amount},
    )

    # 2차 confirm → 이미 PAID
    res = await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_dup_2", "order_id": order_id, "amount": amount},
    )
    assert res.status_code == 400


async def test_get_payment(client, menus, mock_toss):
    """결제 상태 조회 — confirm 후 DONE"""
    create_res = await create_order(client, menus, "pay_get")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_get", "order_id": order_id, "amount": amount},
    )

    res = await client.get(f"/api/payments/{order_id}")
    assert res.status_code == 200
    assert res.json()["status"] == "DONE"


async def test_cancel_payment(client, menus, mock_toss):
    """결제 취소 — DONE → CANCELED"""
    create_res = await create_order(client, menus, "pay_cancel")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    await client.post(
        "/api/payments/confirm",
        json={"payment_key": "pk_cancel", "order_id": order_id, "amount": amount},
    )

    res = await client.post(
        f"/api/payments/{order_id}/cancel",
        json={"reason": "테스트 취소"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "CANCELED"
