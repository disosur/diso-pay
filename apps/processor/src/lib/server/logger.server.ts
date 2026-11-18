import { createLogger, type Logger } from "@diso-pay/logger";
import { PROCESSOR_LOGGER_KEY } from "~/lib/logger-key.ts";

const global = globalThis as typeof globalThis & {
  [key: symbol]: Logger | undefined;
};

export const log: Logger =
  (global[PROCESSOR_LOGGER_KEY] ??= createLogger({ service: "processor" }));
