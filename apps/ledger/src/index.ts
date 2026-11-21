import { LEDGER_PROTO } from "@diso-pay/contracts";
import { createGrpcServer, listen, registerService } from "@diso-pay/grpc";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/index.ts";
import { createLedgerHandlers } from "./grpc.ts";
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

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

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
