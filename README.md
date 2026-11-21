# diso-pay

A small, three-service payment stack in a Bun workspace monorepo. Merchants
create a transaction, customers pick how they want to pay on a hosted checkout
page, and every lifecycle step is appended to a ledger.

```
merchant server
      │  POST /payment/process            (HTTP + JSON)
      ▼
┌──────────────┐    gRPC     ┌──────────────┐    gRPC     ┌──────────────┐
│  processor   │ ──────────► │   payment    │ ──────────► │    ledger    │
│ TanStack     │             │  Hono        │             │  Drizzle +   │
│ Start        │ ──────────► │  gRPC server │             │  SQLite      │
└──────────────┘             └──────┬───────┘             └──────────────┘
      ▲                             │ HTTPS
      │ redirect                    ▼
┌─────┴────────┐          ┌──────────────────┐
│  customer    │          │ Stripe / Xendit  │
│  checkout UI │          └──────────────────┘
└──────────────┘
```

- **processor** (`apps/processor`) — public TanStack Start app. Owns
  `POST /payment/process`, the hosted checkout page, and the provider return
  handler. Talks to the other services over gRPC.
- **payment** (`apps/payment`) — the only service that holds provider keys and
  talks to Stripe or Xendit. Also the only place that knows the
  method → provider and currency rules.
- **ledger** (`apps/ledger`) — append-only event store backed by SQLite through
  Drizzle. Transaction state is derived by folding the event log.

Shared code lives in `packages/contracts` (protos, types, validation, money and
routing rules) and `packages/grpc` (a tiny typed gRPC runtime).

## Services and ports

| Service   | HTTP                | gRPC                    | Env file                |
| --------- | ------------------- | ----------------------- | ----------------------- |
| ledger    | —                   | `127.0.0.1:50051`       | `apps/ledger/.env`      |
| payment   | `localhost:4012`    | `127.0.0.1:50052`       | `apps/payment/.env`     |
| processor | `localhost:3000`    | —                       | `apps/processor/.env`   |

The ledger is gRPC-only. The processor is the public HTTP API; payment serves
`/health` and the provider webhook endpoints. All service-to-service work
happens over gRPC.

## Setup

```sh
bun install

cp apps/ledger/.env.example apps/ledger/.env
cp apps/payment/.env.example apps/payment/.env
cp apps/processor/.env.example apps/processor/.env

# fill in provider keys
$EDITOR apps/payment/.env

bun run db:migrate   # creates apps/ledger/data/ledger.sqlite and applies migrations
bun run dev          # starts ledger, payment, and processor
```

`bun run dev` runs each service in its own process with its own `.env`.

Useful commands:

```sh
bun test             # contract, routing, and gRPC round-trip tests
bun run typecheck    # bun check in every workspace package
bun run db:generate  # regenerate drizzle migrations after changing the schema
bun run db:studio    # open Drizzle Studio at https://local.drizzle.studio
bun run build        # build the processor
```

## Creating a transaction

`POST /payment/process` accepts a Stripe/Xendit-shaped body. Amounts are in
minor units (cents), so `50000` is ₱500.00.

| Field                   | Required | Notes                                                     |
| ----------------------- | -------- | --------------------------------------------------------- |
| `line_items[]`          | yes      | `name`, `amount` (minor units), `quantity`, optional `image` |
| `success_url`           | yes      | merchant URL after a successful payment                   |
| `cancel_url`            | yes      | merchant URL when the customer backs out                  |
| `currency`              | no       | `PHP` (default) or `USD`                                   |
| `customer_reference_id` | no       | merchant order id; enables transaction reuse               |
| `description`           | no       | shown on the checkout page                                 |
| `customer_email`        | no       | pre-fills the provider where supported                     |
| `payment_method`        | no       | `card`, `gcash`, `maya`, or `qrph`; locks the link to that method alone |
| `metadata`              | no       | string map, copied to the provider                         |
| `expires_at`            | no       | unix seconds, default now + 30 min, max now + 24 h         |

```sh
curl -X POST localhost:3000/payment/process \
  -H 'content-type: application/json' \
  -d '{
    "currency": "PHP",
    "customer_reference_id": "order_0001",
    "description": "Order order_0001",
    "success_url": "https://shop.test/ok",
    "cancel_url": "https://shop.test/cancel",
    "line_items": [{ "name": "Item 1", "amount": 50000, "quantity": 1 }]
  }'
```

```json
{
  "id": "txn_9272088a4a544fd49a32fc41f7741099",
  "url": "http://localhost:3000/payment/txn_9272088a4a544fd49a32fc41f7741099",
  "status": "pending",
  "currency": "PHP",
  "amount_total": 50000,
  "expires_at": 1795000147,
  "reused": false
}
```

Redirect the customer to `url`. New transactions return `201`; reused ones
return `200` with `"reused": true`.

### Reuse

A transaction is reusable while it is `pending` or `awaiting_payment` and its
expiry has not passed. Two reuse points:

1. Calling `/payment/process` again with the same `customer_reference_id`,
   currency, and amount returns the existing link.
2. Picking a method/currency pair that already has a live provider session
   returns that provider session instead of creating another one.

Expired or completed transactions are never reused.

## Checkout page

`GET /payment/:id` is a React page (TanStack Start + Tailwind + shadcn/ui dark
theme) where the customer picks a method and currency.

| Method          | Provider  | Currency                     |
| --------------- | --------- | ---------------------------- |
| `card`          | Stripe    | up to the customer: PHP or USD |
| `gcash`         | Xendit    | PHP only                     |
| `maya`          | Xendit    | PHP only                     |
| `qrph`          | Xendit    | PHP only                     |

PHP-only methods force PHP and convert the line items with the current
USD → PHP rate. The server derives the provider amount from the same cached
quote, and validates it against each provider's minimum before a session is
created.

### FX rates

When `STRIPE_SECRET_KEY` is set, the payment service fetches a USD → PHP rate
from Stripe's [FX Quotes API](https://docs.stripe.com/payments/currencies/localize-prices/fx-quotes-api)
and uses its `base_rate` (mid-market, without Stripe's FX fee). Quotes are
cached for `FX_STRIPE_LOCK_DURATION` (`none`, `five_minutes`, `hour`, or `day`)
and the checkout page shows the rate source and remaining lock time.

The FX Quotes API is a Stripe preview feature: your Stripe account must have
access to the `2026-09-30.preview` API version, and the API is only available in
some merchant countries. When the quote cannot be fetched, the service logs a
warning and falls back to `FX_PHP_PER_USD` until the next retry. Set
`FX_STRIPE_LOCK_DURATION=none` to skip the paid lock duration; informational
quotes still refresh automatically.

The page calls `POST`-style server functions, which call the payment service. No
provider keys or gRPC ports are reachable from the browser.

Pass `payment_method` when creating a transaction to lock the link to a single
method. The checkout page then renders that method only, with no picker, and the
payment service rejects any other method with `payment_method_not_allowed`. The
chosen method is also forwarded to the provider (Xendit receives
`allowed_payment_channels: ['GCASH']`, or `PAYMAYA` / `QRPH`, and therefore
offers nothing else on its hosted page).

### Provider redirects

Stripe and Xendit are given
`POST /payment/:id/return?outcome=success|cancel` as their return URLs. The
handler appends a `checkout.returned` event and `302`s the customer to the
merchant's `success_url` or `cancel_url`.

> **Local development with Xendit:** Xendit requires `HTTPS` return URLs, so it
> rejects `localhost` and `127.0.0.1`. When the configured return base is a
> loopback URL, the payment service automatically falls back to the merchant's
> own `success_url`/`cancel_url` for Xendit sessions (and logs a warning), so
> the GCash/Maya/QR Ph flow still works locally — you just lose the
> `checkout.returned` ledger event for those payments.
>
> To keep return tracking, expose the processor with a tunnel and set
> `CHECKOUT_RETURN_BASE_URL=https://your-tunnel` in `apps/payment/.env`.

### Payment status

Poll the current state of an order or transaction through the processor:

- `GET /payment/:id/status` — by transaction id
- `GET /orders/:reference/status` — latest transaction for a merchant reference

Both read the ledger over gRPC (`GetTransaction` or
`FindTransactionByReference`, plus `ListEvents`) and return the folded
transaction with a `status_history` array: one entry per event, with the status
after that event and the event's parsed `payload` when it isn't empty. The
transaction also carries its checkout `url` (built from `PUBLIC_ORIGIN`, falling
back to the request origin). Expired transactions get a derived
`transaction.expired` entry. The routes return `404` when nothing matches and
`503` when the ledger is unreachable.

## Webhooks

The payment service accepts provider webhooks, prints every payload to the
console, and appends a `payment.succeeded` event when the provider confirms a
completed payment. The fold in `packages/contracts` treats that event as
terminal `completed`, so fulfilment can rely on it instead of the return
redirect.

| Provider | Endpoint                            | Signing secret          |
| -------- | ----------------------------------- | ----------------------- |
| Stripe   | `POST http://localhost:4012/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` |
| Xendit   | `POST http://localhost:4012/webhooks/xendit` | `XENDIT_WEBHOOK_TOKEN`  |

Webhooks are authenticated before a payload is logged:

- Stripe uses `Stripe-Signature` with a 5 minute tolerance.
- Xendit sends a static verification token in the `x-callback-token` header.
  The service compares it to `XENDIT_WEBHOOK_TOKEN` in constant time.

If a secret is not set, the service logs a warning and accepts the payload
without verification. Requests with a bad signature get `400`. Verified events
that cannot be written to the ledger get `502` so the provider retries; anything
else gets `200`.

`payment.succeeded` is recorded for Stripe `checkout.session.completed` /
`checkout.session.async_payment_succeeded` and Xendit
`payment_session.completed`. The transaction is resolved from
`metadata.transaction_id`, falling back to `reference_id` / `client_reference_id`
(when it is a transaction id, or through `FindActiveTransaction` for a merchant
reference). Replays are deduped by provider session id.

Local Stripe:

```sh
stripe listen --forward-to localhost:4012/webhooks/stripe
# copy the whsec_… it prints into apps/payment/.env
```

Xendit requires a public HTTPS URL, so expose the payment service with a tunnel
and register `https://your-tunnel/webhooks/xendit` in the Xendit dashboard under
webhook settings. Copy the callback verification token from that page into
`XENDIT_WEBHOOK_TOKEN`.

## Ledger

`apps/ledger` stores one append-only `events` table. A transaction's state is
computed by folding its events in order; nothing is ever updated in place.

| Event type                 | Written by | Meaning                                                           |
| -------------------------- | ---------- | ----------------------------------------------------------------- |
| `transaction.created`      | processor  | line items, currency, return URLs                                 |
| `checkout.opened`          | processor  | customer opened the checkout link (recorded once per transaction) |
| `checkout.session_created` | payment    | provider session + hosted URL                                     |
| `checkout.session_reused`  | payment    | an existing live session was reused                               |
| `checkout.returned`        | processor  | provider sent the customer back                                   |
| `payment.succeeded`        | payment    | provider confirmed the payment                                    |

Derived status: `pending` → `awaiting_payment` → `completed`, or `expired`
once the deadline passes. Each append can carry an `idempotency_key`; replays
return the original event with `duplicate: true`.

Reads go through the ledger's gRPC service. The processor exposes the
merchant-facing status views over HTTP (`GET /payment/:id/status` and
`GET /orders/:reference/status`); the ledger has no HTTP server.

Reset local data with `rm apps/ledger/data/ledger.sqlite*` and re-run
`bun run db:migrate`.

## gRPC

Protos live in `packages/contracts/src/proto` as TypeScript string constants, so
the schema is bundled with the code and works under Bun, Vite SSR, and Nitro
builds without copying `.proto` files around. `packages/grpc` compiles them with
`protobufjs` at load time and exposes typed unary clients and servers.

- `PaymentService.CreateCheckoutSession` — `{ transaction_id, method, currency }`
- `PaymentService.GetCheckoutOptions` — methods, currencies, FX rate, default TTL
- `LedgerService.AppendEvent` / `GetTransaction` / `FindActiveTransaction` / `FindTransactionByReference` / `ListEvents`

Business errors travel as gRPC status codes and become HTTP codes in the
processor: `NOT_FOUND` → 404, `INVALID_ARGUMENT` → 400,
`FAILED_PRECONDITION` → 409, `UNAVAILABLE` → 503.

## Logging

All three services use `@diso-pay/logger`. One logger per process, writing to
`stdout` for `debug`/`info`/`warn` and `stderr` for `error`.

- `LOG_LEVEL` — `debug`, `info` (default), `warn`, or `error`.
- `LOG_FORMAT` — `pretty` (default outside production) or `json` (default when
  `NODE_ENV=production`). Pretty lines look like
  `14:02:11.871 INFO payment checkout session created transaction_id=txn_… duration_ms=183`;
  JSON lines are single objects with `time`, `level`, `service`, `msg`, and fields.

Every HTTP request gets a request id from the incoming `x-request-id` header or a
generated UUID. The processor, payment, and ledger pass it through gRPC metadata,
so one id covers the whole call path. Follow one request end to end with:

```sh
grep -r 'request_id=req_…' logs/
# or, with JSON logs:
grep 'req_…' logs/*.log
```

Logs never include provider API keys, `Authorization` headers, full redirect
URLs, or customer emails.

## Environment

`apps/payment/.env`

```sh
PORT=4012
PAYMENT_GRPC_HOST=127.0.0.1
PAYMENT_GRPC_PORT=50052
LEDGER_GRPC_ADDRESS=127.0.0.1:50051
PROCESSOR_PUBLIC_URL=http://localhost:3000
CHECKOUT_RETURN_BASE_URL=
FX_PHP_PER_USD=58
FX_STRIPE_LOCK_DURATION=hour
TRANSACTION_TTL_SECONDS=1800
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_API_BASE_URL=https://api.stripe.com
XENDIT_SECRET_API_KEY=
XENDIT_WEBHOOK_TOKEN=
XENDIT_API_BASE_URL=https://api.xendit.co
```

`apps/ledger/.env`

```sh
LEDGER_GRPC_HOST=127.0.0.1
LEDGER_GRPC_PORT=50051
LEDGER_DATABASE_PATH=./data/ledger.sqlite
```

`apps/processor/.env`

```sh
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
LEDGER_GRPC_ADDRESS=127.0.0.1:50051
PAYMENT_GRPC_ADDRESS=127.0.0.1:50052
TRANSACTION_TTL_SECONDS=1800
```

## Not included yet

The provider return redirect is a UX signal, not proof of payment. Use the
webhook-recorded `payment.succeeded` event for fulfilment.

`POST /payment/process` is intentionally unauthenticated so the checkout page
can be opened by anyone holding the link. Put merchant authentication (an API
key or signed request) in front of it before production, and consider a unique
index on `customer_reference_id` if you need strict single-active-transaction
guarantees under concurrent requests.
