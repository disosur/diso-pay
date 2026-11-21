import {
  DEFAULT_PHP_PER_USD,
  formatAmount,
  isPhpOnlyMethod,
  planCharge,
  validateChargePlan,
  type CheckoutOptions,
  type Currency,
  type LineItem,
  type MethodOption,
  type PaymentMethod,
} from "@diso-pay/contracts";
import {
  CreditCard,
  Loader2,
  Lock,
  Package,
  QrCode,
  Smartphone,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import type { PublicTransaction } from "~/lib/server/checkout.server.ts";
import { describeCheckoutError } from "~/lib/errors";
import { startCheckout } from "~/lib/checkout.functions";
import { cn } from "~/lib/utils";

const METHOD_ICONS = {
  card: CreditCard,
  gcash: Wallet,
  maya: Smartphone,
  qrph: QrCode,
} satisfies Record<PaymentMethod, typeof CreditCard>;

const PROVIDER_LABELS = {
  stripe: "Stripe",
  xendit: "Xendit",
} as const;

function MethodDetails({ option }: { option: MethodOption }) {
  return (
    <span className="min-w-0 space-y-1">
      <span className="flex items-center gap-2 text-sm font-medium leading-none">
        {option.label}
        {option.php_only ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            PHP only
          </Badge>
        ) : null}
      </span>
      <span className="block text-xs leading-relaxed text-muted-foreground">
        {option.description}
      </span>
    </span>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ProductRow({ item, currency }: { item: LineItem; currency: Currency }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = item.image;

  return (
    <div className="flex items-center gap-3">
      <div className="size-12 shrink-0 overflow-hidden rounded-lg border bg-muted">
        {image && !imageFailed ? (
          <img
            src={image}
            alt={item.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <Package className="size-5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {item.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatAmount(item.amount, currency)} × {item.quantity}
        </p>
      </div>

      <span className="shrink-0 text-sm font-medium tabular-nums">
        {formatAmount(item.amount * item.quantity, currency)}
      </span>
    </div>
  );
}

export function CheckoutForm({
  transaction,
  options,
}: {
  transaction: PublicTransaction;
  options: CheckoutOptions;
}) {
  const lockedMethod = transaction.payment_method;
  const restricted = lockedMethod
    ? options.methods.filter((option) => option.id === lockedMethod)
    : null;
  const methods = restricted && restricted.length > 0 ? restricted : options.methods;

  const [method, setMethod] = useState<PaymentMethod>(lockedMethod || "card");
  const [currency, setCurrency] = useState<Currency>(transaction.currency);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const rate = Number(options.fx_php_per_usd) || DEFAULT_PHP_PER_USD;
  const liveRate = options.fx_rate_source === "stripe";
  const rateLockMinutes =
    liveRate && now !== null && options.fx_rate_locked_until > now
      ? Math.max(1, Math.ceil((options.fx_rate_locked_until - now) / 60_000))
      : null;
  const phpOnly = isPhpOnlyMethod(method);
  const effectiveCurrency: Currency = phpOnly ? "PHP" : currency;

  const plan = useMemo(
    () =>
      planCharge({
        method,
        currency: effectiveCurrency,
        source_currency: transaction.currency,
        line_items: transaction.line_items,
        phpPerUsd: rate,
      }),
    [method, effectiveCurrency, transaction.line_items, rate],
  );

  const validation = validateChargePlan(plan);
  const remainingMs = now === null ? null : transaction.expires_at - now;
  const expired = remainingMs !== null && remainingMs <= 0;
  const converted = plan.currency !== transaction.currency;
  const rateExpired =
    converted &&
    liveRate &&
    now !== null &&
    options.fx_rate_locked_until > 0 &&
    now >= options.fx_rate_locked_until;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || expired || rateExpired || validation) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await startCheckout({
        data: {
          transaction_id: transaction.id,
          method,
          currency: effectiveCurrency,
        },
      });

      window.location.assign(result.url);
    } catch (caught) {
      setError(describeCheckoutError(caught));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>Payment method</Label>
          <span className="text-xs text-muted-foreground">
            {expired
              ? "Link expired"
              : remainingMs === null
                ? "Reserving your link"
                : `Expires in ${formatRemaining(remainingMs)}`}
          </span>
        </div>

        {lockedMethod && restricted && restricted.length > 0 ? (
          restricted.map((option) => {
            const Icon = METHOD_ICONS[option.id] ?? CreditCard;

            return (
              <div
                key={option.id}
                className="flex items-start gap-3 rounded-lg border border-ring bg-accent/60 p-3"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-foreground" />
                <MethodDetails option={option} />
              </div>
            );
          })
        ) : (
          <div role="radiogroup" aria-label="Payment method" className="grid gap-2 sm:grid-cols-2">
            {methods.map((option) => {
              const Icon = METHOD_ICONS[option.id] ?? CreditCard;
              const selected = method === option.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMethod(option.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    selected
                      ? "border-ring bg-accent/60"
                      : "border-border hover:bg-accent/30",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      selected ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                  <MethodDetails option={option} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>Currency</Label>
          {phpOnly ? (
            <span className="text-xs text-muted-foreground">
              {method.toUpperCase()} settles in PHP only
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {options.currencies.map((option) => {
            const disabled = phpOnly && option !== "PHP";
            const selected = effectiveCurrency === option;

            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => setCurrency(option)}
                className={cn(
                  "flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors",
                  selected
                    ? "border-ring bg-accent/60 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/30",
                  disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border bg-background/40">
        <div className="space-y-4 p-4">
          <div className="space-y-4">
            {plan.line_items.map((item, index) => (
              <ProductRow
                key={`${item.name}-${index}`}
                item={item}
                currency={plan.currency}
              />
            ))}
          </div>

          <Separator />

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">Total</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatAmount(plan.amount, plan.currency)}
            </span>
          </div>

          {converted ? (
            <p className="text-xs text-muted-foreground">
              Converted from {transaction.currency} at 1 USD ={" "}
              {rate.toFixed(2)} PHP
              {liveRate
                ? options.fx_rate_locked_until > 0
                  ? rateExpired
                    ? " · rate quote expired, reload to refresh"
                    : rateLockMinutes
                      ? ` · live rate, locked for ${rateLockMinutes}m`
                      : " · live rate"
                  : " · live rate"
                : ""}
              .
            </p>
          ) : null}
        </div>
      </div>

      {validation ? (
        <Alert variant="destructive">{describeCheckoutError(new Error(validation))}</Alert>
      ) : null}

      {rateExpired ? (
        <Alert variant="destructive">
          The exchange rate quote for this total expired. Reload the page to see
          the latest price.
        </Alert>
      ) : null}

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {expired ? (
        <Alert variant="destructive">
          This payment link has expired. Ask the merchant for a fresh link.
        </Alert>
      ) : null}

      <div className="space-y-3">
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={submitting || expired || rateExpired || Boolean(validation)}
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin" />
              Starting checkout
            </>
          ) : (
            <>
              <Lock />
              Pay {formatAmount(plan.amount, plan.currency)} with{" "}
              {PROVIDER_LABELS[plan.provider]}
            </>
          )}
        </Button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" />
          You will be redirected to {PROVIDER_LABELS[plan.provider]} to complete
          the payment.
        </p>
      </div>
    </form>
  );
}
