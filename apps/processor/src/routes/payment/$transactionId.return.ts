import { createFileRoute } from "@tanstack/react-router";
import { log } from "~/lib/server/logger.server.ts";
import { handleCheckoutReturn } from "~/lib/server/checkout.server.ts";

export const Route = createFileRoute("/payment/$transactionId/return")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const started = performance.now();
        const url = new URL(request.url);
        const outcome =
          url.searchParams.get("outcome") === "success" ? "success" : "cancel";

        try {
          const redirectUrl = await handleCheckoutReturn(
            params.transactionId,
            outcome,
          );
          const target = redirectUrl ?? new URL("/", url.origin).toString();

          log.info("checkout return", {
            transaction_id: params.transactionId,
            outcome,
            found: redirectUrl !== null,
            redirect_host: new URL(target).host,
            duration_ms: Math.round(performance.now() - started),
          });

          return Response.redirect(target, 302);
        } catch (error) {
          log.error("checkout return failed", {
            transaction_id: params.transactionId,
            outcome,
            duration_ms: Math.round(performance.now() - started),
            err: error,
          });
          return Response.redirect(new URL("/", url.origin).toString(), 302);
        }
      },
    },
  },
});
