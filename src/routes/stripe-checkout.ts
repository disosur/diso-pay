import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import Stripe from "stripe";
import { z } from "zod";
import { getStripe } from "../stripe.ts";

const lineItemSchema = z.object({
  name: z.string().min(1),
  amount: z.number().int().positive(),
  quantity: z.number().int().positive(),
  image: z.url().optional(),
});

const createCheckoutSessionSchema = z.object({
  currency: z.string().length(3).toLowerCase().default("php"),
  success_url: z.url(),
  cancel_url: z.url(),
  line_items: z.array(lineItemSchema).min(1),
  customer_email: z.email().optional(),
  customer_reference_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  expires_at: z.number().int().positive().optional(),
});

export const stripeRoutes = new Hono().post(
  "/checkout/sessions",
  zValidator("json", createCheckoutSessionSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation_error", detail: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const input = c.req.valid("json");

    try {
      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        success_url: input.success_url,
        cancel_url: input.cancel_url,
        line_items: input.line_items.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: input.currency,
            unit_amount: item.amount,
            product_data: {
              name: item.name,
              ...(item.image ? { images: [item.image] } : {}),
            },
          },
        })),
        customer_email: input.customer_email,
        client_reference_id: input.customer_reference_id,
        metadata: input.metadata,
        expires_at: input.expires_at,
      });

      if (!session.url) {
        console.error("Stripe returned a Checkout Session without a url", session.id);
        return c.json({ error: "stripe_returned_no_url" }, 502);
      }

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
      if (error instanceof Stripe.errors.StripeAuthenticationError) {
        console.error("Stripe rejected the secret API key", error.message);
        return c.json({ error: "stripe_authentication_failed" }, 500);
      }

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        return c.json({ error: "stripe_request_invalid", detail: error.message }, 400);
      }

      if (error instanceof Stripe.errors.StripeError) {
        console.error("Stripe request failed", error.type, error.message);
        return c.json({ error: "stripe_unavailable" }, 502);
      }

      console.error("Unexpected error creating Stripe checkout session", error);
      return c.json({ error: "internal_error" }, 500);
    }
  },
);
