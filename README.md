# diso-pay

Hono server for PayRex Checkout.

```sh
cp .env.example .env   # then set PAYREX_SECRET_API_KEY
bun dev
```

## Endpoints

- `GET /health`
- `POST /checkout/sessions` — creates a PayRex CheckoutSession and returns its `url`
- `POST /stripe/checkout/sessions` — creates a Stripe Checkout Session and returns its `url`

Stripe request (same line item shape, `amount` in cents):

```sh
curl -X POST localhost:3000/stripe/checkout/sessions \
  -H 'content-type: application/json' \
  -d '{
    "currency": "php",
    "success_url": "https://shop.test/ok",
    "cancel_url": "https://shop.test/cancel",
    "line_items": [{ "name": "Item 1", "amount": 10000, "quantity": 1 }]
  }'
```

Stripe offers card, GrabPay, and other methods per your account; which ones appear is set in the Stripe Dashboard (Settings → Payment methods).

```sh
curl -X POST localhost:3000/checkout/sessions \
  -H 'content-type: application/json' \
  -d '{
    "success_url": "https://shop.test/ok",
    "cancel_url": "https://shop.test/cancel",
    "line_items": [{ "name": "Item 1", "amount": 10000, "quantity": 1 }]
  }'
```

Amounts are in cents (10000 = ₱100.00). Redirect the customer to the returned `url`.
