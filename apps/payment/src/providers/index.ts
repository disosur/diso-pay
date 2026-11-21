import type { Provider } from "@diso-pay/contracts";
import type { PaymentConfig } from "../config.ts";
import { createXenditProvider } from "./xendit.ts";
import { createStripeProvider } from "./stripe.ts";
import type { CheckoutProvider } from "./types.ts";

export type ProviderRegistry = Record<Provider, CheckoutProvider>;

export function createProviderRegistry(config: PaymentConfig): ProviderRegistry {
  return {
    stripe: createStripeProvider(config.stripeSecretKey),
    xendit: createXenditProvider({
      secretKey: config.xenditSecretKey,
      baseUrl: config.xenditApiBaseUrl,
    }),
  };
}

export * from "./types.ts";
