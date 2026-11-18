import { isPaymentMethod } from "./methods.ts";
import type {
  Currency,
  LedgerEvent,
  LineItem,
  PaymentMethod,
  PaymentSession,
  Provider,
  Transaction,
  TransactionStatus,
} from "./types.ts";

export const TRANSACTION_CREATED = "transaction.created";
export const CHECKOUT_SESSION_CREATED = "checkout.session_created";
export const CHECKOUT_SESSION_REUSED = "checkout.session_reused";
export const CHECKOUT_RETURNED = "checkout.returned";

export type CreatedPayload = {
  currency: Currency;
  amount_total: number;
  line_items: LineItem[];
  success_url: string;
  cancel_url: string;
  reference?: string;
  description?: string;
  customer_email?: string;
  payment_method?: PaymentMethod;
  metadata?: Record<string, string>;
  expires_at: number;
};

export type SessionPayload = {
  provider: Provider;
  method: PaymentMethod;
  currency: Currency;
  amount: number;
  provider_session_id: string;
  url: string;
  expires_at: number;
};

export type ReturnedPayload = {
  outcome: "success" | "cancel";
  provider: string;
  method: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function parseCreatedPayload(value: unknown): CreatedPayload | null {
  if (!isRecord(value)) return null;

  const { currency, amount_total, line_items, success_url, cancel_url, expires_at } = value;

  if (currency !== "PHP" && currency !== "USD") return null;
  if (!isPositiveInteger(amount_total)) return null;
  if (!Array.isArray(line_items) || line_items.length === 0) return null;
  if (!isHttpUrl(success_url) || !isHttpUrl(cancel_url)) return null;
  if (!isPositiveInteger(expires_at)) return null;
  if (value.payment_method !== undefined && !isPaymentMethod(value.payment_method)) {
    return null;
  }

  const items: LineItem[] = [];
  for (const item of line_items) {
    if (!isRecord(item)) return null;
    if (typeof item.name !== "string" || item.name.length === 0) return null;
    if (!isPositiveInteger(item.amount)) return null;
    if (!isPositiveInteger(item.quantity)) return null;
    if (item.image !== undefined && typeof item.image !== "string") return null;

    items.push({
      name: item.name,
      amount: item.amount,
      quantity: item.quantity,
      ...(typeof item.image === "string" && item.image.length > 0
        ? { image: item.image }
        : {}),
    });
  }

  return {
    currency,
    amount_total,
    line_items: items,
    success_url,
    cancel_url,
    ...(typeof value.reference === "string" && value.reference.length > 0
      ? { reference: value.reference }
      : {}),
    ...(typeof value.description === "string" && value.description.length > 0
      ? { description: value.description }
      : {}),
    ...(typeof value.customer_email === "string" && value.customer_email.length > 0
      ? { customer_email: value.customer_email }
      : {}),
    ...(isPaymentMethod(value.payment_method)
      ? { payment_method: value.payment_method }
      : {}),
    ...(isRecord(value.metadata)
      ? {
          metadata: Object.fromEntries(
            Object.entries(value.metadata).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
        }
      : {}),
    expires_at,
  };
}

function parsePayload<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function foldTransaction(
  events: LedgerEvent[],
  now = Date.now(),
): Transaction | null {
  const created = events[0];
  if (!created || created.type !== TRANSACTION_CREATED) return null;

  const payload = parsePayload<CreatedPayload>(created.payload_json);
  if (!payload) return null;

  const sessions = new Map<string, PaymentSession>();
  let lastOutcome = "";
  let updatedAt = created.created_at;

  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;

    updatedAt = Math.max(updatedAt, event.created_at);

    if (event.type === CHECKOUT_SESSION_CREATED || event.type === CHECKOUT_SESSION_REUSED) {
      const session = parsePayload<SessionPayload>(event.payload_json);
      if (!session) continue;

      const existing = sessions.get(session.provider_session_id);
      sessions.set(session.provider_session_id, {
        ...session,
        created_at: existing?.created_at ?? event.created_at,
      });
      continue;
    }

    if (event.type === CHECKOUT_RETURNED) {
      const returned = parsePayload<ReturnedPayload>(event.payload_json);
      if (!returned) continue;

      if (returned.outcome === "success") {
        lastOutcome = "success";
      } else if (lastOutcome.length === 0) {
        lastOutcome = "cancel";
      }
    }
  }

  const sessionList = [...sessions.values()].sort(
    (left, right) => left.created_at - right.created_at,
  );

  const status: TransactionStatus =
    lastOutcome === "success"
      ? "completed"
      : now >= payload.expires_at
        ? "expired"
        : sessionList.length > 0
          ? "awaiting_payment"
          : "pending";

  return {
    id: created.transaction_id,
    status,
    currency: payload.currency,
    amount_total: payload.amount_total,
    line_items: payload.line_items,
    success_url: payload.success_url,
    cancel_url: payload.cancel_url,
    reference: payload.reference ?? "",
    description: payload.description ?? "",
    customer_email: payload.customer_email ?? "",
    payment_method: payload.payment_method ?? "",
    metadata: payload.metadata ?? {},
    sessions: sessionList,
    created_at: created.created_at,
    expires_at: payload.expires_at,
    updated_at: updatedAt,
    last_outcome: lastOutcome,
  };
}

export function isTransactionActive(
  transaction: Transaction,
  now = Date.now(),
): boolean {
  return (
    (transaction.status === "pending" || transaction.status === "awaiting_payment") &&
    now < transaction.expires_at
  );
}

export function findReusableSession(
  transaction: Transaction,
  input: { method: PaymentMethod; currency: Currency; amount: number },
  now = Date.now(),
): PaymentSession | null {
  for (let index = transaction.sessions.length - 1; index >= 0; index -= 1) {
    const session = transaction.sessions[index];
    if (!session) continue;

    if (
      session.method === input.method &&
      session.currency === input.currency &&
      session.amount === input.amount &&
      session.expires_at > now
    ) {
      return session;
    }
  }

  return null;
}
