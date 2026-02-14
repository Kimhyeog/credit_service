import os

# 테스트 DB 설정 — 앱 import보다 먼저!
os.environ["DATABASE_URL"] = "file:./test.db"
os.environ["TOSS_SECRET_KEY"] = "test_sk_dummy"
os.environ["TOSS_WEBHOOK_SECRET"] = "test_webhook_secret_for_testing"

import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.client import db


@pytest.fixture(scope="session", autouse=True)
async def setup_db():
    """테스트 세션: DB 연결 → 시드 → 테스트 → 정리"""
    await db.connect()

    # 기존 데이터 정리 (이전 테스트 잔여)
    await db.webhookevent.delete_many()
    await db.idempotencyrecord.delete_many()
    await db.payment.delete_many()
    await db.orderitem.delete_many()
    await db.order.delete_many()
    await db.menu.delete_many()

    # 시드 메뉴 3개
    await db.menu.create(
        data={"name": "아메리카노", "price": 4500, "category": "커피"}
    )
    await db.menu.create(
        data={"name": "카페라떼", "price": 5500, "category": "커피"}
    )
    await db.menu.create(
        data={"name": "크루아상", "price": 4000, "category": "베이커리"}
    )

    yield

    await db.disconnect()


@pytest.fixture(autouse=True)
async def cleanup():
    """각 테스트 후 주문/결제/웹훅 데이터 정리 (메뉴는 유지)"""
    yield
    await db.webhookevent.delete_many()
    await db.idempotencyrecord.delete_many()
    await db.payment.delete_many()
    await db.orderitem.delete_many()
    await db.order.delete_many()


@pytest.fixture
async def client():
    """FastAPI async test client"""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def menus():
    """현재 DB의 메뉴 목록 반환"""
    return await db.menu.find_many()


@pytest.fixture
def mock_toss():
    """Toss API mock — confirm/get/cancel 모두 AsyncMock"""
    with patch("app.services.payment_service.toss_client") as mock:
        mock.confirm_payment = AsyncMock(return_value={
            "paymentKey": "test_pk_123",
            "orderId": "test-order-id",
            "status": "DONE",
            "method": "카드",
            "approvedAt": "2026-02-15T12:00:00+09:00",
        })
        mock.get_payment = AsyncMock(return_value={
            "paymentKey": "test_pk_123",
            "status": "DONE",
        })
        mock.cancel_payment = AsyncMock(return_value={
            "paymentKey": "test_pk_123",
            "status": "CANCELED",
        })
        yield mock
