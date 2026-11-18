import { Hono } from "hono";
import { PAYMENT_PROTO } from "@diso-pay/contracts";
import { createGrpcServer, listen, registerService } from "@diso-pay/grpc";
import { loadConfig } from "./config.ts";
import { createPaymentHandlers } from "./grpc.ts";
import { createLedgerClient } from "./ledger-client.ts";
import { log } from "./logger.ts";
import { createProviderRegistry } from "./providers/index.ts";
import { createPaymentService } from "./service.ts";

const config = loadConfig();
const ledger = createLedgerClient(config.ledgerAddress);
const providers = createProviderRegistry(config);
const service = createPaymentService({
  config,
  ledger: ledger.client,
  providers,
});

const grpcServer = createGrpcServer();
registerService(grpcServer, PAYMENT_PROTO, createPaymentHandlers(service));

const grpcPort = await listen(grpcServer, config.grpcAddress);

log.info("grpc server listening", {
  address: config.grpcAddress,
  port: grpcPort,
});

const app = new Hono();

app.get("/", (c) => c.json({ name: "diso-pay-payment", status: "ok" }));

app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    providers: {
      stripe: config.stripeSecretKey.length > 0,
      payrex: config.payrexSecretKey.length > 0,
    },
  }),
);

const httpServer = Bun.serve({
  port: config.httpPort,
  fetch: app.fetch,
});

log.info("http server listening", { port: httpServer.port });

log.info("payment service ready", {
  ledger_target: config.ledgerAddress,
  processor_public_url: config.processorPublicUrl,
  return_base: config.checkoutReturnBaseUrl || "loopback fallback",
  fx_php_per_usd: config.fxPhpPerUsd,
  stripe_key_present: config.stripeSecretKey.length > 0,
  payrex_key_present: config.payrexSecretKey.length > 0,
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  httpServer.stop();
  ledger.close();

  grpcServer.tryShutdown(() => process.exit(0));

  setTimeout(() => {
    grpcServer.forceShutdown();
    process.exit(0);
  }, 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
