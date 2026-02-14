from fastapi import HTTPException
from prisma import Prisma


class OrderService:
    def __init__(self, db: Prisma):
        self.db = db
    

    # 주문 생성 함수
    async def create_order(self, items, idempotency_key):
        # 1. 메뉴 조회 + 가격 합산
        total = 0
        order_items_data = []
        for item in items:
            menu = await self.db.menu.find_unique(where={"id": item.menu_id})
            if not menu or not menu.isAvailable:
                raise HTTPException(404, f"Menu not found: {item.menu_id}")
            total += menu.price * item.quantity
            order_items_data.append({
                "menuId": item.menu_id,
                "quantity": item.quantity,
                "price": menu.price,        # ← 주문 시점 가격 스냅샷!
            })

        # 2. 주문번호 채번
        last_order = await self.db.order.find_first(order={"orderNumber": "desc"})
        next_number = (last_order.orderNumber + 1) if last_order else 1

        # 3. 주문 + 주문항목 일괄 생성
        order = await self.db.order.create(
            data={
                "orderNumber": next_number,
                "totalAmount": total,
                "idempotencyKey": idempotency_key,
                "items": {"create": order_items_data},
            },
            include={"items": {"include": {"menu": True}}},
        )
        return order


    # 모든 주문들 조회 함수
    async def get_orders(self, status=None):
        where = {}
        if status:
            where["status"] = status
        return await self.db.order.find_many(
            where=where,
            include={"items": {"include": {"menu": True}}, "payment": True},
            order={"createdAt": "desc"},
        )


    # 특정 주문 조회 함수
    async def get_order(self, order_id):
        order = await self.db.order.find_unique(
            where={"id": order_id},
            include={"items": {"include": {"menu": True}}, "payment": True},
        )
        if not order:
            raise HTTPException(404, "Order not found")
        return order

    # 특정 주문 취소함수
    async def cancel_order(self, order_id):
        order = await self.get_order(order_id)
        if order.status not in ["PENDING", "PAYMENT_PENDING"]:
            raise HTTPException(400, f"Cannot cancel order in {order.status} status")
        return await self.db.order.update(
            where={"id": order_id},
            data={"status": "CANCELLED"},
        )
