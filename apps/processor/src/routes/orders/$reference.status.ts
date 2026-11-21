import { createFileRoute } from "@tanstack/react-router";
import { getTransactionStatusByReference } from "~/lib/server/status.server.ts";

const MAX_REFERENCE_LENGTH = 200;

function failure(error: string, status: number) {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/orders/$reference/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const reference = params.reference.trim();

        if (reference.length === 0 || reference.length > MAX_REFERENCE_LENGTH) {
          return failure("invalid_reference", 400);
        }

        const result = await getTransactionStatusByReference(
          reference,
          new URL(request.url).origin,
        );
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
