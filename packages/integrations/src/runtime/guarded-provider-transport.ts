import type { ZodType } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";
import type {
  ProviderRuntime,
  ProviderOperationName,
  ProviderRuntimeContext,
} from "./provider-runtime";

export type ProviderTransportRequest = {
  operation: string;
  path: string;
  body: Readonly<Record<string, unknown>>;
  idempotencyKey?: string;
};

/**
 * Last-mile enforcement for every adapter sharing ProviderJsonTransport. The
 * inner transport cannot execute until durable gate policy has passed.
 */
export class GuardedProviderJsonTransport implements ProviderJsonTransport {
  public constructor(
    private readonly inner: ProviderJsonTransport,
    private readonly runtime: ProviderRuntime,
    private readonly context: (
      request: ProviderTransportRequest,
    ) => ProviderRuntimeContext,
    private readonly operationPolicy: (
      request: ProviderTransportRequest,
    ) => ProviderOperationName = defaultProviderOperationPolicy,
  ) {}

  public request<T>(input: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    response: ZodType<T>;
    idempotencyKey?: string;
  }): Promise<T> {
    const request: ProviderTransportRequest = {
      operation: input.operation,
      path: input.path,
      body: input.body,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
    return this.runtime.execute({
      operation: this.operationPolicy(request),
      context: {
        ...this.context(request),
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      },
      invoke: () => this.inner.request(input),
    });
  }
}

export function defaultProviderOperationPolicy(
  input: ProviderTransportRequest,
): ProviderOperationName {
  if (input.operation === "provisioning.provision")
    return "provisioning.provision";
  if (input.operation === "provisioning.teardown")
    return "provisioning.teardown";
  if (input.operation.startsWith("marketplace."))
    return input.operation.includes("reconcil")
      ? "marketplace.reconcile"
      : "marketplace.effect";
  if (input.operation === "migration.snapshot.load")
    return input.body.executionMode === "execute"
      ? "migration.execute"
      : "migration.snapshot.read";
  if (
    input.operation.includes("reconcil") ||
    input.operation === "usage.pull" ||
    input.operation.endsWith(".get") ||
    input.operation.endsWith(".read")
  )
    return "provider.reconcile";
  return "provider.effect";
}
