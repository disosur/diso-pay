import { z } from "zod";
import { CURRENCIES, PAYMENT_METHODS } from "./types.ts";

export const lineItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  amount: z.number().int().positive(),
  quantity: z.number().int().positive().max(1000).default(1),
  image: z.url().optional(),
});

export const processPaymentSchema = z.object({
  currency: z.enum(CURRENCIES).default("PHP"),
  line_items: z.array(lineItemSchema).min(1).max(50),
  success_url: z.url(),
  cancel_url: z.url(),
  customer_reference_id: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  customer_email: z.email().optional(),
  payment_method: z.enum(PAYMENT_METHODS).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  expires_at: z.number().int().positive().optional(),
});

export type ProcessPaymentInput = z.infer<typeof processPaymentSchema>;

export const createSessionSchema = z.object({
  transaction_id: z.string().trim().min(1),
  method: z.enum(PAYMENT_METHODS),
  currency: z.enum(CURRENCIES),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const transactionIdSchema = z
  .string()
  .trim()
  .regex(/^txn_[a-f0-9]{32}$/, "invalid_transaction_id");
