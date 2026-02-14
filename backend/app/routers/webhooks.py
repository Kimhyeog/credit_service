from fastapi import APIRouter, Request
from app.db.client import get_db
from app.services.webhook_service import WebhookService

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@router.post("/toss")
async def toss_webhook(request: Request):
    """
    Toss 웹훅 수신 엔드포인트

    Toss가 결제 상태 변경 시 이 엔드포인트로 POST 요청을 보낸다.
    항상 200 OK를 반환하여 Toss의 재시도를 방지한다.

    Request.json()을 사용하는 이유:
    - Toss가 스키마를 변경해도 에러 없이 수신
    - 원본 payload를 WebhookEvent에 그대로 저장
    """
    body = await request.json()

    db = get_db()
    service = WebhookService(db)
    result = await service.handle_toss_webhook(body)

    return result
