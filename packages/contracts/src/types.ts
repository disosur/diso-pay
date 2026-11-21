export const CURRENCIES = ["PHP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PAYMENT_METHODS = ["card", "gcash", "maya", "qrph"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PROVIDERS = ["stripe", "xendit"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const FX_RATE_SOURCES = ["stripe", "static"] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

export const TRANSACTION_STATUSES = [
  "pending",
  "awaiting_payment",
  "completed",
  "expired",
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type LineItem = {
  name: string;
  amount: number;
  quantity: number;
  image?: string;
};

export type PaymentSession = {
  provider: Provider;
  method: PaymentMethod;
  currency: Currency;
  amount: number;
  provider_session_id: string;
  url: string;
  expires_at: number;
  created_at: number;
};

export type Transaction = {
  id: string;
  status: TransactionStatus;
  currency: Currency;
  amount_total: number;
  line_items: LineItem[];
  success_url: string;
  cancel_url: string;
  reference: string;
  description: string;
  customer_email: string;
  payment_method: PaymentMethod | "";
  metadata: Record<string, string>;
  sessions: PaymentSession[];
  created_at: number;
  expires_at: number;
  updated_at: number;
  last_outcome: string;
};

export type LedgerEvent = {
  id: number;
  transaction_id: string;
  sequence: number;
  type: string;
  payload_json: string;
  idempotency_key: string;
  created_at: number;
};

export type MethodOption = {
  id: PaymentMethod;
  label: string;
  provider: Provider;
  php_only: boolean;
  description: string;
};

export type CheckoutOptions = {
  methods: MethodOption[];
  currencies: Currency[];
  fx_php_per_usd: string;
  fx_rate_source: FxRateSource;
  fx_rate_locked_until: number;
  transaction_ttl_seconds: number;
};

export type AppendEventRequest = {
  transaction_id: string;
  type: string;
  payload_json: string;
  idempotency_key: string;
};

export type AppendEventResponse = {
  event: LedgerEvent;
  duplicate: boolean;
};

export type GetTransactionRequest = { transaction_id: string };
export type GetTransactionResponse = { transaction: Transaction };
export type FindActiveTransactionRequest = { reference: string };
export type FindActiveTransactionResponse = { transaction: Transaction | null };
export type ListEventsRequest = { transaction_id: string };
export type ListEventsResponse = { events: LedgerEvent[] };

export type CreateCheckoutSessionRequest = {
  transaction_id: string;
  method: PaymentMethod;
  currency: Currency;
};

export type CheckoutSessionResponse = {
  transaction_id: string;
  provider: Provider;
  method: PaymentMethod;
  currency: Currency;
  amount: number;
  provider_session_id: string;
  url: string;
  expires_at: number;
  reused: boolean;
};

export type LedgerClient = {
  AppendEvent(req: AppendEventRequest): Promise<AppendEventResponse>;
  GetTransaction(req: GetTransactionRequest): Promise<GetTransactionResponse>;
  FindActiveTransaction(
    req: FindActiveTransactionRequest,
  ): Promise<FindActiveTransactionResponse>;
  ListEvents(req: ListEventsRequest): Promise<ListEventsResponse>;
};

export type PaymentClient = {
  CreateCheckoutSession(
    req: CreateCheckoutSessionRequest,
  ): Promise<CheckoutSessionResponse>;
  GetCheckoutOptions(req: Record<string, never>): Promise<CheckoutOptions>;
};
