/** 주문 모드 — 매장 식사 / 포장 */
export type OrderMode = "DINE_IN" | "TAKE_OUT";

export interface OrderItemCreate {
  menu_id: string;
  quantity: number;
}

export interface OrderCreateRequest {
  items: OrderItemCreate[];
  idempotency_key: string;
  order_mode?: OrderMode;
  source?: "POS" | "KIOSK" | "TABLE";
  table_id?: string;
}

export interface OrderItemResponse {
  id: string;
  quantity: number;
  price: number;
  menuId: string;
  menu: {
    id: string;
    name: string;
    price: number;
    category: string;
  };
}

export interface OrderResponse {
  id: string;
  orderNumber: number;
  status: string;
  totalAmount: number;
  idempotencyKey: string;
  source: string;
  orderMode: string;
  tableId: string | null;
  items: OrderItemResponse[];
  payment: PaymentResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentResponse {
  id: string;
  paymentKey: string | null;
  status: string;
  amount: number;
  method: string | null;
  approvedAt: string | null;
}
