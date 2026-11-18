import type { Provider } from "@diso-pay/contracts";
import type { PaymentConfig } from "../config.ts";
import { createPayrexProvider } from "./payrex.ts";
import { createStripeProvider } from "./stripe.ts";
import type { CheckoutProvider } from "./types.ts";

export type ProviderRegistry = Record<Provider, CheckoutProvider>;

export function createProviderRegistry(config: PaymentConfig): ProviderRegistry {
  return {
    stripe: createStripeProvider(config.stripeSecretKey),
    payrex: createPayrexProvider({
      secretKey: config.payrexSecretKey,
      baseUrl: config.payrexApiBaseUrl,
    }),
  };
}

export * from "./types.ts";
