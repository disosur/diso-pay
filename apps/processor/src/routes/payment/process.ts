import { createFileRoute } from "@tanstack/react-router";
import { processPaymentSchema } from "@diso-pay/contracts";
import { log } from "~/lib/server/logger.server.ts";
import { createTransaction } from "~/lib/server/transactions.server.ts";

function failure(error: string, status: number, detail?: unknown) {
  return Response.json(detail === undefined ? { error } : { error, detail }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/payment/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);
        let body: unknown;

        try {
          body = await request.json();
        } catch {
          log.warn("payment/process rejected", {
            code: "invalid_json",
            duration_ms: elapsed(),
          });
          return failure("invalid_json", 400);
        }

        const parsed = processPaymentSchema.safeParse(body);
        if (!parsed.success) {
          log.warn("payment/process rejected", {
            code: "validation_error",
            issues: parsed.error.issues.length,
            duration_ms: elapsed(),
          });
          return failure("validation_error", 400, parsed.error.issues);
        }

        try {
          const origin = new URL(request.url).origin;
          const transaction = await createTransaction(parsed.data, origin);

          log.info("payment/process created", {
            transaction_id: transaction.id,
            amount_total: transaction.amount_total,
            currency: transaction.currency,
            reused: transaction.reused,
            duration_ms: elapsed(),
          });

          return Response.json(transaction, {
            status: transaction.reused ? 200 : 201,
            headers: { "cache-control": "no-store" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "internal_error";
          const code = message.split(":")[0] ?? message;

          if (code.startsWith("expires_at_")) {
            log.warn("payment/process rejected", {
              code,
              duration_ms: elapsed(),
            });
            return failure(code, 400);
          }

          if (code === "ledger_unavailable" || code === "ledger_timeout") {
            log.error("payment/process failed", {
              code,
              duration_ms: elapsed(),
              err: error,
            });
            return failure(code, 503);
          }

          log.error("payment/process failed", {
            code: "internal_error",
            duration_ms: elapsed(),
            err: error,
          });
          return failure("internal_error", 500);
        }
      },
    },
  },
});
