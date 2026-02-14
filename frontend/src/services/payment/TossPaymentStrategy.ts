import { loadTossPayments } from "@tosspayments/payment-sdk";
import { api } from "@/services/api";
import type {
  PaymentService,
  PaymentRequest,
  PaymentConfirmation,
  PaymentResult,
} from "./PaymentService";

const TOSS_CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!;

export class TossPaymentStrategy implements PaymentService {
  async requestPayment(request: PaymentRequest): Promise<void> {
    const toss = await loadTossPayments(TOSS_CLIENT_KEY);

    await toss.requestPayment("카드", {
      amount: request.amount,
      orderId: request.orderId,
      orderName: request.orderName,
      successUrl: `${window.location.origin}${request.successUrl}`,
      failUrl: `${window.location.origin}${request.failUrl}`,
    });
  }

  async confirmPayment(confirmation: PaymentConfirmation): Promise<PaymentResult> {
    return api.post<PaymentResult>("/api/payments/confirm", {
      payment_key: confirmation.paymentKey,
      order_id: confirmation.orderId,
      amount: confirmation.amount,
    });
  }
}
