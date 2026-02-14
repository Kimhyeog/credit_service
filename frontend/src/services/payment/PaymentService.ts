/** 결제 요청 파라미터 */
export interface PaymentRequest {
  orderId: string;
  orderName: string;
  amount: number;
  successUrl: string;
  failUrl: string;
}

/** 결제 승인 요청 파라미터 (success 페이지에서 사용) */
export interface PaymentConfirmation {
  paymentKey: string;
  orderId: string;
  amount: number;
}

/** 결제 승인 결과 */
export interface PaymentResult {
  id: string;
  paymentKey: string | null;
  status: string;
  amount: number;
  method: string | null;
  approvedAt: string | null;
}

/** 결제 서비스 인터페이스 — Strategy 패턴 */
export interface PaymentService {
  /** Toss 결제창 열기 (리다이렉트 방식) */
  requestPayment(request: PaymentRequest): Promise<void>;

  /** 결제 승인 (success 페이지에서 백엔드 confirm 호출) */
  confirmPayment(confirmation: PaymentConfirmation): Promise<PaymentResult>;
}
