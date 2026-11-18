import type {
  ChargePlan,
  Provider,
  Transaction,
} from "@diso-pay/contracts";

export type ProviderCheckoutInput = {
  transaction: Transaction;
  plan: ChargePlan;
  success_url: string;
  cancel_url: string;
};

export type ProviderCheckout = {
  provider_session_id: string;
  url: string;
  expires_at: number;
};

export type ProviderErrorKind = "authentication" | "invalid_request" | "unavailable";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: Provider;
  readonly detail: string;

  constructor(provider: Provider, kind: ProviderErrorKind, message: string, detail = "") {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.detail = detail;
  }
}

export type CheckoutProvider = {
  id: Provider;
  createCheckoutSession(input: ProviderCheckoutInput): Promise<ProviderCheckout>;
};
