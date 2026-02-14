from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.client import db
from app.config import settings
from app.routers import menus, orders, payments, webhooks
from app.middleware.idempotency import IdempotencyMiddleware
from app.middleware.error_handler import register_error_handlers


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

# 글로벌 에러 핸들러 — Prisma/httpx/미처리 예외를 JSON 응답으로 변환
register_error_handlers(app)

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

app.include_router(menus.router)
app.include_router(orders.router)
app.include_router(payments.router)
app.include_router(webhooks.router)