from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db.client import get_db

router = APIRouter(prefix="/api/menus", tags=["menus"])


# ─── 요청 스키마 ───

class MenuCreate(BaseModel):
    name: str
    price: int
    category: str
    imageUrl: str | None = None


class MenuUpdate(BaseModel):
    name: str | None = None
    price: int | None = None
    category: str | None = None
    imageUrl: str | None = None


# ─── 엔드포인트 ───

@router.get("")
async def list_menus():
    db = get_db()
    menus = await db.menu.find_many(
        where={"isAvailable": True},
        order={"category": "asc"},
    )
    return menus


@router.post("", status_code=201)
async def create_menu(body: MenuCreate):
    db = get_db()
    menu = await db.menu.create(data=body.model_dump(exclude_none=True))
    return menu


@router.put("/{menu_id}")
async def update_menu(menu_id: str, body: MenuUpdate):
    db = get_db()
    menu = await db.menu.find_unique(where={"id": menu_id})
    if not menu:
        raise HTTPException(404, "Menu not found")
    updated = await db.menu.update(
        where={"id": menu_id},
        data=body.model_dump(exclude_none=True),
    )
    return updated


@router.delete("/{menu_id}")
async def delete_menu(menu_id: str):
    db = get_db()
    menu = await db.menu.find_unique(where={"id": menu_id})
    if not menu:
        raise HTTPException(404, "Menu not found")
    updated = await db.menu.update(
        where={"id": menu_id},
        data={"isAvailable": False},
    )
    return updated
