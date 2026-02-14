from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.client import db
from app.config import settings
from app.routers import menus, orders, payments
from app.middleware.idempotency import IdempotencyMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()

app = FastAPI(title="Toss-Sync POS API", lifespan=lifespan)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 멱등성 미들웨어 — POST/PATCH 요청의 중복 처리 방지
app.add_middleware(IdempotencyMiddleware)

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

app.include_router(menus.router)
app.include_router(orders.router)
app.include_router(payments.router)