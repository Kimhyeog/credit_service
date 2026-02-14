from datetime import datetime, timedelta, timezone
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from app.db.client import get_db


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    Idempotency-Key 헤더가 있는 POST/PATCH 요청에 대해
    동일한 키로 재요청이 오면 저장된 응답을 반환한다.

    흐름:
    1. POST/PATCH + Idempotency-Key 헤더 → 미들웨어 작동
    2. GET/DELETE, 헤더 없음 → 바로 통과
    3. DB에서 키 조회:
       - 존재 + 미만료 → 저장된 응답 반환 (핸들러 실행 안 함)
       - 존재 + 만료   → 레코드 삭제 → 핸들러 실행 → 새 응답 저장
       - 미존재        → 핸들러 실행 → 응답을 IdempotencyRecord에 저장 (TTL 24시간)
    """

    IDEMPOTENT_METHODS = {"POST", "PATCH"}
    TTL_HOURS = 24

    async def dispatch(self, request: Request, call_next):
        # 멱등성 대상이 아닌 요청은 바로 통과
        if request.method not in self.IDEMPOTENT_METHODS:
            return await call_next(request)

        idem_key = request.headers.get("Idempotency-Key")
        if not idem_key:
            return await call_next(request)

        db = get_db()

        # 1. 기존 레코드 조회
        existing = await db.idempotencyrecord.find_unique(
            where={"idempotencyKey": idem_key}
        )

        if existing:
            # 만료 확인
            if existing.expiresAt < datetime.now(timezone.utc):
                await db.idempotencyrecord.delete(
                    where={"id": existing.id}
                )
                # 만료된 레코드 → 아래에서 핸들러 실행
            else:
                # 저장된 응답 반환 (핸들러 실행 안 함)
                return Response(
                    content=existing.responseBody,
                    status_code=existing.statusCode,
                    media_type="application/json",
                )

        # 2. 핸들러 실행
        response = await call_next(request)

        # 3. 응답 본문 읽기 및 저장
        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        await db.idempotencyrecord.create(
            data={
                "idempotencyKey": idem_key,
                "httpMethod": request.method,
                "path": str(request.url.path),
                "statusCode": response.status_code,
                "responseBody": body.decode("utf-8"),
                "expiresAt": datetime.now(timezone.utc) + timedelta(hours=self.TTL_HOURS),
            }
        )

        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )
