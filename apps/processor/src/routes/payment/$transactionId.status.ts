import { createFileRoute } from "@tanstack/react-router";
import { transactionIdSchema } from "@diso-pay/contracts";
import { getTransactionStatus } from "~/lib/server/status.server.ts";

function failure(error: string, status: number) {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/payment/$transactionId/status")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const parsed = transactionIdSchema.safeParse(params.transactionId);
        if (!parsed.success) {
          return failure("invalid_transaction_id", 400);
        }

        const result = await getTransactionStatus(parsed.data);
        if (!result.ok) {
          return failure(result.reason, result.reason === "not_found" ? 404 : 503);
        }

        return Response.json(
          {
            transaction: result.transaction,
            status_history: result.status_history,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
