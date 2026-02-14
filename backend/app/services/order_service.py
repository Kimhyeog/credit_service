from fastapi import HTTPException
from prisma import Prisma


class OrderService:
    def __init__(self, db: Prisma):
        self.db = db
    

    # 주문 생성 함수
    async def create_order(
        self,
        items,
        idempotency_key,
        source="POS",
        order_mode="DINE_IN",
        table_id=None,
    ):
        # 1. 메뉴 조회 + 가격 합산
        total = 0
        order_items_data = []
        for item in items:
            menu = await self.db.menu.find_unique(where={"id": item.menu_id})
            if not menu or not menu.isAvailable:
                raise HTTPException(404, f"메뉴를 찾을 수 없습니다: {item.menu_id}")
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
                "source": source,
                "orderMode": order_mode,
                "tableId": table_id,
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
            raise HTTPException(404, "주문을 찾을 수 없습니다")
        return order

    # 특정 주문 취소함수
    async def cancel_order(self, order_id):
        order = await self.get_order(order_id)
        if order.status not in ["PENDING", "PAYMENT_PENDING"]:
            raise HTTPException(400, f"{order.status} 상태의 주문은 취소할 수 없습니다")
        return await self.db.order.update(
            where={"id": order_id},
            data={"status": "CANCELLED"},
        )

    # KDS 상태 전환 허용 규칙
    KDS_TRANSITIONS: dict[str, list[str]] = {
        "PAID": ["PREPARING", "CANCELLED"],
        "PREPARING": ["COMPLETED"],
    }

    # KDS 상태 전환 함수
    async def update_status(self, order_id, new_status):
        order = await self.get_order(order_id)
        allowed = self.KDS_TRANSITIONS.get(order.status, [])
        if new_status not in allowed:
            raise HTTPException(
                400,
                f"{order.status}에서 {new_status}(으)로 전환할 수 없습니다. "
                f"가능: {allowed}",
            )
        return await self.db.order.update(
            where={"id": order_id},
            data={"status": new_status},
            include={"items": {"include": {"menu": True}}, "payment": True},
        )
