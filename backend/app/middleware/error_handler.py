import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from prisma.errors import (
    PrismaError,
    RecordNotFoundError,
    UniqueViolationError,
    ForeignKeyViolationError,
)
from httpx import HTTPStatusError

logger = logging.getLogger("toss_sync_pos")


def register_error_handlers(app: FastAPI):
    """앱에 글로벌 에러 핸들러 등록"""

    @app.exception_handler(RecordNotFoundError)
    async def prisma_not_found_handler(request: Request, exc: RecordNotFoundError):
        return JSONResponse(
            status_code=404,
            content={"detail": "요청한 리소스를 찾을 수 없습니다."},
        )

    @app.exception_handler(UniqueViolationError)
    async def prisma_unique_handler(request: Request, exc: UniqueViolationError):
        return JSONResponse(
            status_code=409,
            content={"detail": "중복된 레코드입니다."},
        )

    @app.exception_handler(ForeignKeyViolationError)
    async def prisma_fk_handler(request: Request, exc: ForeignKeyViolationError):
        return JSONResponse(
            status_code=400,
            content={"detail": "참조하는 리소스가 존재하지 않습니다."},
        )

    @app.exception_handler(PrismaError)
    async def prisma_error_handler(request: Request, exc: PrismaError):
        logger.exception(f"Prisma error: {request.method} {request.url.path}")
        return JSONResponse(
            status_code=500,
            content={"detail": "데이터베이스 오류가 발생했습니다."},
        )

    @app.exception_handler(HTTPStatusError)
    async def httpx_error_handler(request: Request, exc: HTTPStatusError):
        logger.error(
            f"External API error: {exc.response.status_code} "
            f"{request.method} {request.url.path}"
        )
        try:
            body = exc.response.json()
            detail = body.get("message", "결제 서비스 오류가 발생했습니다.")
        except Exception:
            detail = "결제 서비스 오류가 발생했습니다."

        return JSONResponse(
            status_code=502,
            content={"detail": detail},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception(f"Unhandled error: {request.method} {request.url.path}")
        return JSONResponse(
            status_code=500,
            content={"detail": "서버 내부 오류가 발생했습니다."},
        )
