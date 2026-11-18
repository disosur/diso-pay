const PAYREX_API_BASE_URL =
  process.env.PAYREX_API_BASE_URL ?? "https://api.payrexhq.com";

export type CheckoutSessionInput = {
  currency: string;
  success_url: string;
  cancel_url: string;
  line_items: Array<{
    name: string;
    amount: number;
    quantity: number;
    image?: string;
  }>;
  payment_methods?: string[];
  customer_reference_id?: string;
  metadata?: Record<string, string>;
  expires_at?: number;
  billing_details_collection?: "auto" | "always";
  description?: string;
  submit_type?: string;
  payment_method_options?: Record<string, unknown>;
};

export type CheckoutSession = {
  id: string;
  url: string;
  status: string;
  client_secret: string;
  currency: string;
  livemode: boolean;
  payment_intent: unknown;
  metadata: Record<string, string> | null;
  success_url: string;
  cancel_url: string;
  payment_methods: string[];
  expires_at: number;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
};

export class PayrexError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`PayRex request failed with status ${status}`);
    this.name = "PayrexError";
    this.status = status;
    this.body = body;
  }
}

function encodeForm(payload: unknown, prefix = "", params = new URLSearchParams()) {
  if (payload === undefined || payload === null) return params;

  if (Array.isArray(payload)) {
    payload.forEach((value, index) => {
      encodeForm(value, `${prefix}[${index}]`, params);
    });
    return params;
  }

  if (typeof payload === "object") {
    for (const [key, value] of Object.entries(payload)) {
      encodeForm(value, prefix ? `${prefix}[${key}]` : key, params);
    }
    return params;
  }

  params.append(prefix, String(payload));
  return params;
}

export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<CheckoutSession> {
  const secretKey = process.env.PAYREX_SECRET_API_KEY;
  if (!secretKey) {
    throw new Error("PAYREX_SECRET_API_KEY is not set");
  }

  const response = await fetch(`${PAYREX_API_BASE_URL}/checkout_sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${secretKey}:`)}`,
    },
    body: encodeForm(input).toString(),
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new PayrexError(response.status, body);
  }

  return body as CheckoutSession;
}
