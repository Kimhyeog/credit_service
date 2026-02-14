import httpx
import base64
from app.config import settings

TOSS_BASE_URL = "https://api.tosspayments.com"


class TossClient:
    """
    Toss Payments API 클라이언트

    인증: Basic Auth — secret key를 base64 인코딩하여 Authorization 헤더에 포함
    형식: Basic base64("{SECRET_KEY}:")  ← 콜론 필수 (비밀번호 없음)
    """

    def __init__(self):
        secret = settings.TOSS_SECRET_KEY
        encoded = base64.b64encode(f"{secret}:".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/json",
        }

    async def confirm_payment(
        self, payment_key: str, order_id: str, amount: int
    ) -> dict:
        """
        결제 승인 요청

        Toss API: POST /v1/payments/confirm
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{TOSS_BASE_URL}/v1/payments/confirm",
                headers=self.headers,
                json={
                    "paymentKey": payment_key,
                    "orderId": order_id,
                    "amount": amount,
                },
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_payment(self, payment_key: str) -> dict:
        """
        결제 상태 조회

        Toss API: GET /v1/payments/{paymentKey}
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{TOSS_BASE_URL}/v1/payments/{payment_key}",
                headers=self.headers,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()

    async def cancel_payment(self, payment_key: str, reason: str) -> dict:
        """
        결제 취소 요청

        Toss API: POST /v1/payments/{paymentKey}/cancel
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{TOSS_BASE_URL}/v1/payments/{payment_key}/cancel",
                headers=self.headers,
                json={"cancelReason": reason},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()


toss_client = TossClient()
