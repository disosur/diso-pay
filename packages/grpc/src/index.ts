import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import { currentRequestId, runWithRequestContext } from "@diso-pay/logger";

export { status } from "@grpc/grpc-js";

export type ProtoDescriptor = {
  source: string;
  package: string;
  service: string;
};

export type UnaryHandler = (request: any) => unknown | Promise<unknown>;

type CompiledMethod = {
  path: string;
  serializeRequest: (value: unknown) => Buffer;
  deserializeRequest: (buffer: Buffer) => unknown;
  serializeResponse: (value: unknown) => Buffer;
  deserializeResponse: (buffer: Buffer) => unknown;
};

type CompiledService = {
  definition: grpc.ServiceDefinition;
  methods: Map<string, CompiledMethod>;
};

const CONVERSION_OPTIONS: protobuf.IConversionOptions = {
  longs: Number,
  enums: String,
  defaults: true,
  arrays: true,
  objects: true,
  oneofs: true,
};

const cache = new Map<string, CompiledService>();

function serviceKey(descriptor: ProtoDescriptor): string {
  return `${descriptor.package}.${descriptor.service}`;
}

function compile(descriptor: ProtoDescriptor): CompiledService {
  const key = serviceKey(descriptor);
  const cached = cache.get(key);
  if (cached) return cached;

  const root = protobuf.parse(descriptor.source, { keepCase: true }).root;
  root.resolveAll();

  const service = root.lookupService(key);
  const definition: Record<string, grpc.MethodDefinition<any, any>> = {};
  const methods = new Map<string, CompiledMethod>();

  for (const method of service.methodsArray) {
    const requestType = method.resolvedRequestType;
    const responseType = method.resolvedResponseType;

    if (!requestType || !responseType) {
      throw new Error(`unresolved_grpc_method:${key}.${method.name}`);
    }

    if (method.requestStream || method.responseStream) {
      throw new Error(`streaming_grpc_method_not_supported:${key}.${method.name}`);
    }

    const path = `/${key}/${method.name}`;
    const serializeRequest = (value: unknown) =>
      Buffer.from(requestType.encode(requestType.fromObject(value as object)).finish());
    const deserializeRequest = (buffer: Buffer) =>
      requestType.toObject(requestType.decode(buffer), CONVERSION_OPTIONS);
    const serializeResponse = (value: unknown) =>
      Buffer.from(responseType.encode(responseType.fromObject(value as object)).finish());
    const deserializeResponse = (buffer: Buffer) =>
      responseType.toObject(responseType.decode(buffer), CONVERSION_OPTIONS);

    definition[method.name] = {
      path,
      requestStream: false,
      responseStream: false,
      requestSerialize: serializeRequest,
      requestDeserialize: deserializeRequest,
      responseSerialize: serializeResponse,
      responseDeserialize: deserializeResponse,
    };

    methods.set(method.name, {
      path,
      serializeRequest,
      deserializeRequest,
      serializeResponse,
      deserializeResponse,
    });
  }

  const compiled: CompiledService = {
    definition: definition as grpc.ServiceDefinition,
    methods,
  };

  cache.set(key, compiled);
  return compiled;
}

export class RpcError extends Error {
  readonly code: grpc.status;
  readonly details: string;

  constructor(code: grpc.status, message: string, details = message) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.details = details;
  }
}

export function rpcError(code: grpc.status, message: string): RpcError {
  return new RpcError(code, message);
}

export function isRpcCode(error: unknown, code: grpc.status): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

export function rpcErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "details" in error) {
    const details = (error as { details: unknown }).details;
    if (typeof details === "string" && details.length > 0) return details;
  }

  return error instanceof Error ? error.message : "unknown_error";
}

export function statusName(code: number): string {
  for (const [name, value] of Object.entries(grpc.status)) {
    if (typeof value === "number" && value === code) return name;
  }

  return `code_${code}`;
}

function requestIdFromMetadata(metadata: grpc.Metadata): string | undefined {
  const value = metadata.get("x-request-id")[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createGrpcServer(): grpc.Server {
  return new grpc.Server();
}

export function registerService(
  server: grpc.Server,
  descriptor: ProtoDescriptor,
  handlers: Record<string, UnaryHandler>,
): void {
  const compiled = compile(descriptor);
  const implementation: Record<string, grpc.handleUnaryCall<any, any>> = {};

  for (const name of compiled.methods.keys()) {
    implementation[name] = (call, callback) => {
      const handler = handlers[name];
      if (!handler) {
        callback({
          code: grpc.status.UNIMPLEMENTED,
          message: `unimplemented:${serviceKey(descriptor)}.${name}`,
        });
        return;
      }

      const requestId =
        requestIdFromMetadata(call.metadata) ?? crypto.randomUUID();

      runWithRequestContext({ requestId }, () => {
        Promise.resolve()
          .then(() => handler(call.request))
          .then((response) => callback(null, response ?? {}))
          .catch((error: unknown) => {
            if (error instanceof RpcError) {
              callback({
                code: error.code,
                message: error.message,
                details: error.details,
              });
              return;
            }

            callback({
              code: grpc.status.INTERNAL,
              message: error instanceof Error ? error.message : "internal_error",
              details: error instanceof Error ? error.message : String(error),
            });
          });
      });
    };
  }

  server.addService(compiled.definition, implementation);
}

export function listen(
  server: grpc.Server,
  address: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) reject(error);
      else resolve(port);
    });
  });
}

export type GrpcClientHandle<T> = {
  client: T;
  close: () => void;
};

export function createGrpcClient<T>(
  descriptor: ProtoDescriptor,
  address: string,
  options: { timeoutMs?: number; credentials?: grpc.ChannelCredentials } = {},
): GrpcClientHandle<T> {
  const compiled = compile(descriptor);
  const channel = new grpc.Client(
    address,
    options.credentials ?? grpc.credentials.createInsecure(),
    {
      "grpc.keepalive_time_ms": 30_000,
      "grpc.keepalive_timeout_ms": 10_000,
      "grpc.enable_retries": 1,
    },
  );

  const client: Record<string, (request?: unknown) => Promise<unknown>> = {};
  const timeoutMs = options.timeoutMs ?? 15_000;

  for (const [name, method] of compiled.methods) {
    client[name] = (request) =>
      new Promise((resolve, reject) => {
        const metadata = new grpc.Metadata();
        const requestId = currentRequestId();
        if (requestId) metadata.set("x-request-id", requestId);

        channel.makeUnaryRequest(
          method.path,
          method.serializeRequest,
          method.deserializeResponse,
          request ?? {},
          metadata,
          { deadline: Date.now() + timeoutMs },
          (error, response) => {
            if (error) reject(error);
            else resolve(response);
          },
        );
      });
  }

  return {
    client: client as T,
    close: () => channel.close(),
  };
}
