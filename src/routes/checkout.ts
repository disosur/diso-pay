import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createCheckoutSession, PayrexError } from "../payrex.ts";

const lineItemSchema = z.object({
  name: z.string().min(1),
  amount: z.number().int().positive(),
  quantity: z.number().int().positive(),
  image: z.url().optional(),
});

const createCheckoutSessionSchema = z.object({
  currency: z.literal("PHP").default("PHP"),
  success_url: z.url(),
  cancel_url: z.url(),
  line_items: z.array(lineItemSchema).min(1),
  payment_methods: z
    .array(z.enum(["gcash", "maya"]))
    .min(1)
    .default(["gcash", "maya"]),
  customer_reference_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  expires_at: z.number().int().positive().optional(),
  billing_details_collection: z.enum(["auto", "always"]).optional(),
  description: z.string().optional(),
  submit_type: z.string().optional(),
});

export const checkoutRoutes = new Hono().post(
  "/sessions",
  zValidator("json", createCheckoutSessionSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation_error", detail: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid("json");

    try {
      const session = await createCheckoutSession(input);

      return c.json(
        {
          id: session.id,
          url: session.url,
          status: session.status,
          expires_at: session.expires_at,
        },
        201,
      );
    } catch (error) {
      if (error instanceof PayrexError) {
        if (error.status === 401) {
          console.error("PayRex rejected the secret API key", error.body);
          return c.json({ error: "payrex_authentication_failed" }, 500);
        }

        if (error.status === 400 || error.status === 404) {
          return c.json({ error: "payrex_request_invalid", detail: error.body }, 400);
        }

        console.error("PayRex request failed", error.status, error.body);
        return c.json({ error: "payrex_unavailable" }, 502);
      }

      console.error("Unexpected error creating checkout session", error);
      return c.json({ error: "internal_error" }, 500);
    }
  },
);
