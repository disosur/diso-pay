export type LedgerConfig = {
  httpPort: number;
  grpcAddress: string;
  databasePath: string;
};

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid_number_env:${name}`);
  }

  return parsed;
}

export function loadConfig(): LedgerConfig {
  return {
    httpPort: envNumber("PORT", 4011),
    grpcAddress: `${envString("LEDGER_GRPC_HOST", "127.0.0.1")}:${envNumber(
      "LEDGER_GRPC_PORT",
      50051,
    )}`,
    databasePath: envString("LEDGER_DATABASE_PATH", "./data/ledger.sqlite"),
  };
}
