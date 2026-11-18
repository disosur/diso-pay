import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import type { Logger } from "@diso-pay/logger";
import { PROCESSOR_LOGGER_KEY } from "~/lib/logger-key.ts";

function describeRequestPath(pathname: string): { path: string; server_fn?: string } {
  const prefix = "/_serverFn/";
  if (!pathname.startsWith(prefix)) return { path: pathname };

  try {
    const payload = JSON.parse(atob(pathname.slice(prefix.length))) as {
      export?: unknown;
    };
    const exported = typeof payload.export === "string" ? payload.export : undefined;
    return { path: "/_serverFn", ...(exported ? { server_fn: exported } : {}) };
  } catch {
    return { path: "/_serverFn" };
  }
}

const requestLogger = createMiddleware().server(
  async ({ request, pathname, next }) => {
    const { createLogger, runWithRequestContext } = await import(
      "@diso-pay/logger"
    );
    const global = globalThis as typeof globalThis & {
      [key: symbol]: Logger | undefined;
    };
    const log = (global[PROCESSOR_LOGGER_KEY] ??= createLogger({
      service: "processor",
    }));

    const incoming = request.headers.get("x-request-id")?.trim();
    const requestId =
      incoming && incoming.length > 0 ? incoming : crypto.randomUUID();

    return runWithRequestContext({ requestId }, async () => {
      const started = performance.now();
      const baseFields = { method: request.method, ...describeRequestPath(pathname) };

      try {
        const result = await next();
        const fields = {
          ...baseFields,
          status: result.response.status,
          duration_ms: Math.round(performance.now() - started),
        };

        if (pathname === "/health") {
          log.debug("http request", fields);
        } else {
          log.info("http request", fields);
        }

        return result;
      } catch (error) {
        const fields = {
          ...baseFields,
          status: error instanceof Response ? error.status : 500,
          duration_ms: Math.round(performance.now() - started),
        };

        if (error instanceof Response) {
          log.warn("http request rejected", fields);
        } else {
          log.error("http request failed", { ...fields, err: error });
        }

        throw error;
      }
    });
  },
);

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestLogger, csrfMiddleware],
}));
