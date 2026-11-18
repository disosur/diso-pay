import { createSessionSchema, transactionIdSchema } from "@diso-pay/contracts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCheckoutPageData, startCheckoutSession } from "./server/checkout.server.ts";

const transactionInput = z.object({ transactionId: transactionIdSchema });

export const getCheckout = createServerFn({ method: "GET" })
  .validator(transactionInput)
  .handler(({ data }) => getCheckoutPageData(data.transactionId));

export const startCheckout = createServerFn({ method: "POST" })
  .validator(createSessionSchema)
  .handler(({ data }) => startCheckoutSession(data));
