import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFormat = "pretty" | "json";

export type Logger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
};

export type RequestContext = {
  requestId: string;
};

export type LoggerOptions = {
  service: string;
  level?: LogLevel;
  format?: LogFormat;
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestStorage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

export function currentRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

function isLogLevel(value: string): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function envLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase() ?? "";
  return isLogLevel(raw) ? raw : "info";
}

function envFormat(): LogFormat {
  const raw = process.env.LOG_FORMAT?.trim().toLowerCase();
  if (raw === "json") return "json";
  if (raw === "pretty") return "pretty";
  return process.env.NODE_ENV === "production" ? "json" : "pretty";
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function prettyTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function formatPrettyValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (typeof value === "string") {
    if (value.length === 0) return '""';
    return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  }

  if (typeof value === "bigint") return value.toString();
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "object") {
    try {
      return JSON.stringify(toSerializable(value));
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function toSerializable(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (depth >= 6) return "[truncated]";
  if (seen.has(value)) return "[circular]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toSerializable(item, seen, depth + 1);
  }

  return result;
}

function mergedFields(
  bindings: Record<string, unknown>,
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...bindings, ...fields };
  const requestId = currentRequestId();

  if (requestId && merged.request_id === undefined) {
    merged.request_id = requestId;
  }

  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }

  return merged;
}

function writePretty(
  service: string,
  level: LogLevel,
  message: string,
  fields: Record<string, unknown>,
): string {
  let line = `${prettyTime(new Date())} ${LEVEL_NAMES[level]} ${service} ${message}`;

  for (const [key, value] of Object.entries(fields)) {
    line += ` ${key}=${formatPrettyValue(value)}`;
  }

  return line;
}

function writeJson(
  service: string,
  level: LogLevel,
  message: string,
  fields: Record<string, unknown>,
): string {
  const record: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    service,
    msg: message,
  };

  for (const [key, value] of Object.entries(fields)) {
    record[key] = toSerializable(value);
  }

  return JSON.stringify(record);
}

function emit(
  service: string,
  format: LogFormat,
  level: LogLevel,
  message: string,
  fields: Record<string, unknown>,
): void {
  try {
    const line =
      format === "json"
        ? writeJson(service, level, message, fields)
        : writePretty(service, level, message, fields);
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  } catch {
    try {
      process.stdout.write(
        `${LEVEL_NAMES[level]} ${service} ${message} [log_error]\n`,
      );
    } catch {}
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? envLevel();
  const format = options.format ?? envFormat();
  const minimum = LEVEL_WEIGHT[level];

  const build = (service: string, bindings: Record<string, unknown>): Logger => {
    const write = (
      entryLevel: LogLevel,
      message: string,
      fields?: Record<string, unknown>,
    ) => {
      if (LEVEL_WEIGHT[entryLevel] < minimum) return;
      emit(service, format, entryLevel, message, mergedFields(bindings, fields));
    };

    return {
      debug: (message, fields) => write("debug", message, fields),
      info: (message, fields) => write("info", message, fields),
      warn: (message, fields) => write("warn", message, fields),
      error: (message, fields) => write("error", message, fields),
      child: (childBindings) => build(service, { ...bindings, ...childBindings }),
    };
  };

  return build(options.service, {});
}
