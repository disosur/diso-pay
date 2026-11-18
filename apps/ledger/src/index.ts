import { runWithRequestContext } from "@diso-pay/logger";
import { LEDGER_PROTO } from "@diso-pay/contracts";
import { createGrpcServer, listen, registerService } from "@diso-pay/grpc";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/index.ts";
import { createLedgerHandlers } from "./grpc.ts";
import { createHttpApp } from "./http.ts";
import { log } from "./logger.ts";

const config = loadConfig();
const { db, sqlite } = openDatabase(config.databasePath);

log.info("database ready", {
  path: config.databasePath,
  migrations: "applied",
});

const grpcServer = createGrpcServer();
registerService(grpcServer, LEDGER_PROTO, createLedgerHandlers(db));

const grpcPort = await listen(grpcServer, config.grpcAddress);

log.info("grpc server listening", {
  address: config.grpcAddress,
  port: grpcPort,
});

const app = createHttpApp(db);

const httpServer = Bun.serve({
  port: config.httpPort,
  fetch: (request) => {
    const incoming = request.headers.get("x-request-id")?.trim();
    const requestId =
      incoming && incoming.length > 0 ? incoming : crypto.randomUUID();

    return runWithRequestContext({ requestId }, async () => {
      const started = performance.now();
      const method = request.method;
      const path = new URL(request.url).pathname;

      try {
        const response = await app.fetch(request);
        log.info("http request", {
          method,
          path,
          status: response.status,
          duration_ms: Math.round(performance.now() - started),
        });
        return response;
      } catch (error) {
        log.error("http request failed", {
          method,
          path,
          duration_ms: Math.round(performance.now() - started),
          err: error,
        });
        throw error;
      }
    });
  },
});

log.info("http server listening", { port: httpServer.port });

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  httpServer.stop();
  grpcServer.tryShutdown(() => {
    sqlite.close();
    process.exit(0);
  });

  setTimeout(() => {
    grpcServer.forceShutdown();
    sqlite.close();
    process.exit(0);
  }, 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
