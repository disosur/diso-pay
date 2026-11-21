import { afterEach, describe, expect, test } from "bun:test";
import { spyOn } from "bun:test";
import {
  createLogger,
  currentRequestId,
  getRequestContext,
  runWithRequestContext,
} from "../src/index.ts";

const restores: Array<() => void> = [];
const originalEnv = { ...process.env };

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const outSpy = spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);

  restores.push(() => outSpy.mockRestore(), () => errSpy.mockRestore());

  return {
    stdout,
    stderr,
    lines: () => stdout.join("").split("\n").filter(Boolean),
    errorLines: () => stderr.join("").split("\n").filter(Boolean),
  };
}

afterEach(() => {
  for (const restore of restores.splice(0)) restore();

  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }

  Object.assign(process.env, originalEnv);
});

describe("pretty format", () => {
  test("renders time, level, service, message and compact fields", () => {
    const out = capture();
    const log = createLogger({ service: "ledger", level: "debug", format: "pretty" });

    log.info("grpc call", { method: "AppendEvent", duration_ms: 12, note: "two words", ok: true });

    const lines = out.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} INFO ledger grpc call method=AppendEvent duration_ms=12 note="two words" ok=true$/,
    );
  });

  test("quotes strings with spaces and renders errors as Name: message", () => {
    const out = capture();
    const log = createLogger({ service: "payment", level: "debug", format: "pretty" });

    log.error("failed", { err: new TypeError("bad value"), code: "INTERNAL" });

    expect(out.errorLines()[0]).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} ERROR payment failed err=TypeError: bad value code=INTERNAL$/,
    );
    expect(out.stdout.join("")).toBe("");
    expect(out.stderr.join("")).toContain("TypeError: bad value");
  });
});

describe("json format", () => {
  test("emits one json line with time, level, service, msg and fields", () => {
    const out = capture();
    const log = createLogger({ service: "processor", level: "debug", format: "json" });

    log.warn("slow request", { duration_ms: 51, path: "/payment/process" });

    const record = JSON.parse(out.lines()[0]!);
    expect(record.level).toBe("warn");
    expect(record.service).toBe("processor");
    expect(record.msg).toBe("slow request");
    expect(record.duration_ms).toBe(51);
    expect(record.path).toBe("/payment/process");
    expect(new Date(record.time).toISOString()).toBe(record.time);
  });

  test("serializes errors without an empty object", () => {
    const out = capture();
    const log = createLogger({ service: "ledger", level: "debug", format: "json" });

    log.error("boom", { err: new Error("kaput") });

    const record = JSON.parse(out.errorLines()[0]!);
    expect(record.err).toEqual({
      name: "Error",
      message: "kaput",
      stack: expect.any(String),
    });
    expect(JSON.stringify(record.err)).not.toBe("{}");
  });
});

describe("level filtering", () => {
  test("drops entries below the configured level", () => {
    const out = capture();
    const log = createLogger({ service: "ledger", level: "warn", format: "pretty" });

    log.debug("debug line");
    log.info("info line");
    log.warn("warn line");
    log.error("error line");

    expect(out.lines()).toHaveLength(1);
    expect(out.lines()[0]!.endsWith("WARN ledger warn line")).toBe(true);
    expect(out.errorLines()[0]!.endsWith("ERROR ledger error line")).toBe(true);
  });

  test("defaults level to info from LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "debug";
    const out = capture();
    const log = createLogger({ service: "ledger", format: "pretty" });

    log.debug("visible");
    expect(out.lines()[0]!.endsWith("DEBUG ledger visible")).toBe(true);
  });

  test("defaults to json when NODE_ENV is production", () => {
    delete process.env.LOG_FORMAT;
    process.env.NODE_ENV = "production";
    const out = capture();
    const log = createLogger({ service: "ledger", level: "info" });

    log.info("hello");
    const record = JSON.parse(out.lines()[0]!);
    expect(record.msg).toBe("hello");
  });
});

describe("child bindings", () => {
  test("inherits parent bindings and allows overrides", () => {
    const out = capture();
    const log = createLogger({ service: "payment", level: "debug", format: "json" });
    const child = log.child({ transaction_id: "txn_1", provider: "stripe" });

    child.info("session", { provider: "xendit", amount: 100 });

    const record = JSON.parse(out.lines()[0]!);
    expect(record.transaction_id).toBe("txn_1");
    expect(record.provider).toBe("xendit");
    expect(record.amount).toBe(100);
  });
});

describe("request context", () => {
  test("attaches request_id inside runWithRequestContext", () => {
    const out = capture();
    const log = createLogger({ service: "processor", level: "debug", format: "json" });

    const context = runWithRequestContext({ requestId: "req_abc" }, () => {
      expect(currentRequestId()).toBe("req_abc");
      expect(getRequestContext()).toEqual({ requestId: "req_abc" });
      log.info("inside");
      return getRequestContext();
    });

    expect(context).toEqual({ requestId: "req_abc" });
    expect(JSON.parse(out.lines()[0]!).request_id).toBe("req_abc");
    expect(currentRequestId()).toBeUndefined();
  });

  test("does not add request_id outside a context", () => {
    const out = capture();
    const log = createLogger({ service: "processor", level: "debug", format: "json" });

    log.info("outside");
    expect("request_id" in JSON.parse(out.lines()[0]!)).toBe(false);
  });

  test("keeps request_id across awaited work", async () => {
    const out = capture();
    const log = createLogger({ service: "processor", level: "debug", format: "json" });

    await runWithRequestContext({ requestId: "req_async" }, async () => {
      await Promise.resolve();
      log.info("later");
    });

    expect(JSON.parse(out.lines()[0]!).request_id).toBe("req_async");
  });
});
