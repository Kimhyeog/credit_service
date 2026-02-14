from pydantic import BaseModel, Field
from datetime import datetime

# ─── 요청 스키마 ───

class OrderItemCreate(BaseModel):
    menu_id: str
    quantity: int = Field(ge=1)

class OrderCreate(BaseModel):
    items: list[OrderItemCreate]
    idempotency_key: str = Field(min_length=16, max_length=64)
    source: str = "POS"
    order_mode: str = "DINE_IN"
    table_id: str | None = None

class OrderStatusUpdate(BaseModel):
    status: str

class PaymentConfirmRequest(BaseModel):
    payment_key: str
    order_id: str
    amount: int

class PaymentCancelRequest(BaseModel):
    reason: str = "고객 요청 취소"

# ─── 응답 스키마 ───

class OrderResponse(BaseModel):
    id: str
    order_number: int
    status: str
    total_amount: int
    source: str
    order_mode: str
    table_id: str | None
    items: list[dict]
    created_at: datetime

    model_config = {"from_attributes": True}

class PaymentResponse(BaseModel):
    id: str
    payment_key: str | None
    status: str
    amount: int
    method: str | None
    approved_at: datetime | None

    model_config = {"from_attributes": True}