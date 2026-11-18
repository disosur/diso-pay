import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          status: "ok",
          service: "processor",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          targets: {
            ledger: process.env.LEDGER_GRPC_ADDRESS ?? "127.0.0.1:50051",
            payment: process.env.PAYMENT_GRPC_ADDRESS ?? "127.0.0.1:50052",
          },
        }),
    },
  },
});
