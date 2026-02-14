import type {
  PaymentService,
  PaymentRequest,
  PaymentConfirmation,
  PaymentResult,
} from "./PaymentService";

export class MockPaymentStrategy implements PaymentService {
  async requestPayment(request: PaymentRequest): Promise<void> {
    const mockPaymentKey = `mock_pk_${Date.now()}`;
    const params = new URLSearchParams({
      paymentKey: mockPaymentKey,
      orderId: request.orderId,
      amount: String(request.amount),
    });

    window.location.href = `${request.successUrl}&${params.toString()}`;
  }

  async confirmPayment(confirmation: PaymentConfirmation): Promise<PaymentResult> {
    return {
      id: `mock_${confirmation.orderId}`,
      paymentKey: confirmation.paymentKey,
      status: "DONE",
      amount: confirmation.amount,
      method: "카드",
      approvedAt: new Date().toISOString(),
    };
  }
}
