import asyncio
from prisma import Prisma

SEED_MENUS = [
    {"name": "아메리카노", "price": 4500, "category": "커피"},
    {"name": "결제확인", "price": 100, "category": "기타"},
    {"name": "카페라떼", "price": 5000, "category": "커피"},
    {"name": "바닐라라떼", "price": 5500, "category": "커피"},
    {"name": "녹차라떼", "price": 5500, "category": "음료"},
    {"name": "초코라떼", "price": 5500, "category": "음료"},
    {"name": "딸기스무디", "price": 6000, "category": "음료"},
    {"name": "크로와상", "price": 3500, "category": "베이커리"},
    {"name": "치즈케이크", "price": 6500, "category": "베이커리"},
]

async def main():
    db = Prisma()
    await db.connect()

    # 외래 키 순서: Payment → OrderItem → Order → Menu
    await db.payment.delete_many()
    await db.orderitem.delete_many()
    await db.order.delete_many()
    deleted = await db.menu.delete_many()
    print(f"Cleared existing data (menus: {deleted}).")

    for menu in SEED_MENUS:
        await db.menu.create(data=menu)
        print(f"  Created: {menu['name']}")

    print(f"\nSeeded {len(SEED_MENUS)} menus.")
    await db.disconnect()

asyncio.run(main())