import { createFileRoute } from "@tanstack/react-router";
import { formatAmount } from "@diso-pay/contracts";
import { CircleCheck, Clock, Lock, ShieldAlert } from "lucide-react";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { CheckoutForm } from "~/components/checkout-form";
import { getCheckout } from "~/lib/checkout.functions";

export const Route = createFileRoute("/payment/$transactionId")({
  loader: ({ params }) =>
    getCheckout({ data: { transactionId: params.transactionId } }),
  head: () => ({
    meta: [{ title: "Checkout — diso-pay" }],
  }),
  component: CheckoutPage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-5 py-12">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-semibold tracking-tight">diso-pay</span>
        <Badge variant="outline" className="gap-1.5 text-muted-foreground">
          <Lock className="size-3" />
          Secure checkout
        </Badge>
      </div>
      {children}
      <p className="px-1 text-center text-xs text-muted-foreground">
        Card details are handled by the payment provider and never reach
        diso-pay.
      </p>
    </main>
  );
}

function CheckoutPage() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-destructive" />
              {result.reason === "not_found"
                ? "Payment link not found"
                : "Checkout is unavailable"}
            </CardTitle>
            <CardDescription>
              {result.reason === "not_found"
                ? "This link may have been mistyped or removed. Ask the merchant for a new one."
                : "We could not reach the payment service. Please try again in a moment."}
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const { transaction, options } = result;

  if (transaction.status === "completed") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleCheck className="size-4 text-emerald-400" />
              Payment completed
            </CardTitle>
            <CardDescription>
              {formatAmount(transaction.amount_total, transaction.currency)} has
              already been paid on this link.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">
                {transaction.description || "Complete your payment"}
              </CardTitle>
              <CardDescription>
                {transaction.reference
                  ? `Reference ${transaction.reference}`
                  : `Transaction ${transaction.id.slice(0, 12)}…`}
              </CardDescription>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold tabular-nums">
                {formatAmount(transaction.amount_total, transaction.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {transaction.currency}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {transaction.status === "expired" ? (
            <Alert variant="destructive">
              <span className="flex items-center gap-2 font-medium">
                <Clock className="size-4" />
                This payment link has expired.
              </span>
              <p className="mt-1 text-xs opacity-80">
                Ask the merchant to issue a new checkout link.
              </p>
            </Alert>
          ) : (
            <CheckoutForm transaction={transaction} options={options} />
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
