"""주문 API 테스트 — 6개 케이스"""


def make_idempotency_key(suffix=""):
    """테스트용 멱등성 키 생성 (16자 이상)"""
    return f"test_idem_key_{suffix or '0001'}"


async def create_order(client, menus, suffix="0001"):
    """헬퍼: 주문 생성 (메뉴 2종) + 응답 반환"""
    key = make_idempotency_key(suffix)
    response = await client.post(
        "/api/orders",
        json={
            "items": [
                {"menu_id": menus[0].id, "quantity": 2},
                {"menu_id": menus[1].id, "quantity": 1},
            ],
            "idempotency_key": key,
            "source": "POS",
            "order_mode": "DINE_IN",
        },
        headers={"Idempotency-Key": key},
    )
    return response


async def test_create_order_success(client, menus):
    """주문 생성 — 아메리카노*2 + 카페라떼*1 = 14500"""
    res = await create_order(client, menus)
    assert res.status_code == 201
    data = res.json()
    assert data["totalAmount"] == 14500
    assert data["status"] == "PENDING"
    assert data["orderNumber"] >= 1
    assert len(data["items"]) == 2


async def test_create_order_invalid_menu(client):
    """존재하지 않는 메뉴 ID → 404"""
    key = make_idempotency_key("bad_menu")
    res = await client.post(
        "/api/orders",
        json={
            "items": [{"menu_id": "nonexistent-id", "quantity": 1}],
            "idempotency_key": key,
        },
        headers={"Idempotency-Key": key},
    )
    assert res.status_code == 404


async def test_list_orders(client, menus):
    """주문 목록 조회 — 생성 후 1개 이상"""
    await create_order(client, menus, "list1")
    res = await client.get("/api/orders")
    assert res.status_code == 200
    assert len(res.json()) >= 1


async def test_list_orders_filter(client, menus):
    """주문 목록 상태 필터 — PAID 필터 시 PENDING 주문 미포함"""
    await create_order(client, menus, "filter1")
    res = await client.get("/api/orders?status=PAID")
    assert res.status_code == 200
    assert len(res.json()) == 0


async def test_cancel_order_success(client, menus):
    """주문 취소 — PENDING 상태에서 성공"""
    create_res = await create_order(client, menus, "cancel1")
    order_id = create_res.json()["id"]
    key = make_idempotency_key("cancel1_op")
    res = await client.patch(
        f"/api/orders/{order_id}/cancel",
        headers={"Idempotency-Key": key},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "CANCELLED"


async def test_cancel_order_invalid_status(client, menus, mock_toss):
    """PAID 상태 주문 취소 시도 → 400"""
    create_res = await create_order(client, menus, "cancel_bad")
    order_id = create_res.json()["id"]
    amount = create_res.json()["totalAmount"]

    # 결제 confirm → PAID 상태로 전환
    await client.post(
        "/api/payments/confirm",
        json={
            "payment_key": "pk_cancel_test",
            "order_id": order_id,
            "amount": amount,
        },
    )

    # PAID 상태에서 cancel_order 시도
    key = make_idempotency_key("cancel_bad_op")
    res = await client.patch(
        f"/api/orders/{order_id}/cancel",
        headers={"Idempotency-Key": key},
    )
    assert res.status_code == 400
