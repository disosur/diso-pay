import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CreditCard, Layers, ShieldCheck, Wallet } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";

export const Route = createFileRoute("/")({
  component: Home,
});

const EXAMPLE_REQUEST = `curl -X POST 'http://localhost:3000/payment/process' \\
  -H 'content-type: application/json' \\
  -d '{
    "currency": "PHP",
    "customer_reference_id": "order_0001",
    "description": "Order order_0001",
    "success_url": "https://example.com/checkout/success",
    "cancel_url": "https://example.com/checkout/cancel",
    "line_items": [
      { "name": "Hello", "amount": 50000, "quantity": 1 }
    ]
  }'`;

const EXAMPLE_RESPONSE = `{
  "id": "txn_7f4c1a20b9e34c0f9a5c2d8e6b1f3a42",
  "url": "http://localhost:3000/payment/txn_7f4c…",
  "status": "pending",
  "currency": "PHP",
  "amount_total": 50000,
  "expires_at": 1795000147,
  "reused": false
}`;

function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="space-y-4">
        <Badge variant="outline" className="gap-1.5">
          <ShieldCheck className="size-3.5" />
          Unified checkout
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          One checkout for every payment method
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          The processor service creates a transaction, hands back a hosted
          checkout link, and routes the customer to Stripe or Xendit depending
          on the method they pick. Every lifecycle step is appended to the
          ledger.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card className="gap-3 py-5">
          <CardHeader className="gap-2">
            <CreditCard className="size-5 text-muted-foreground" />
            <CardTitle className="text-sm">Cards</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Processed by Stripe in PHP or USD.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="gap-3 py-5">
          <CardHeader className="gap-2">
            <Wallet className="size-5 text-muted-foreground" />
            <CardTitle className="text-sm">Wallets</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              GCash and Maya, always charged in PHP.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="gap-3 py-5">
          <CardHeader className="gap-2">
            <Layers className="size-5 text-muted-foreground" />
            <CardTitle className="text-sm">QR Ph</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Bank-app QR payments through Xendit.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Create a transaction
          </h2>
          <p className="text-sm text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              POST /payment/process
            </code>{" "}
            creates or reuses an active transaction and returns the checkout
            URL. Amounts are in minor units.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Request
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <pre className="overflow-x-auto rounded-lg border bg-background/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                {EXAMPLE_REQUEST}
              </pre>
            </CardContent>
          </Card>

          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Response
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <pre className="overflow-x-auto rounded-lg border bg-background/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                {EXAMPLE_RESPONSE}
              </pre>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">How it flows</h2>
        <ol className="space-y-2 text-sm text-muted-foreground">
          {[
            "The merchant calls /payment/process with line items and return URLs.",
            "The processor writes a transaction.created event to the ledger and returns a hosted checkout link.",
            "The customer picks a currency and method on the checkout page.",
            "The payment service creates the provider session (Stripe for cards, Xendit for PHP wallets and QR Ph).",
            "Provider redirects come back through the processor, are appended to the ledger, and forward to the merchant.",
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium text-foreground">
                {index + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex items-center gap-2 pt-4 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Card data never touches diso-pay servers.
        <ArrowRight className="ml-auto size-3.5" />
      </footer>
    </main>
  );
}
