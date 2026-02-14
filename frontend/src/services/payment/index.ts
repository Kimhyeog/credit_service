import { TossPaymentStrategy } from "./TossPaymentStrategy";
import { MockPaymentStrategy } from "./MockPaymentStrategy";
import type { PaymentService } from "./PaymentService";

export type { PaymentService, PaymentRequest, PaymentConfirmation, PaymentResult } from "./PaymentService";

export function createPaymentService(): PaymentService {
  const useMock = process.env.NEXT_PUBLIC_PAYMENT_MOCK === "true";
  return useMock ? new MockPaymentStrategy() : new TossPaymentStrategy();
}
