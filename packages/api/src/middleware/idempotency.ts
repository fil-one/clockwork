import { createHash, randomUUID } from "node:crypto";

import { IdempotencyKeySchema, ProblemError } from "@clockwork/contracts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  withInternalTransaction,
} from "@clockwork/db";
import type { RuntimeDatabase } from "@clockwork/db";
import { createMiddleware } from "hono/factory";

import type { ApiVariables } from "../context";

interface StoredResponse {
  requestHash: string;
  state: "running" | "complete";
  claimToken?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
}
export interface IdempotencyStore {
  claim(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<
    | { kind: "claimed"; claimToken: string }
    | { kind: "conflict" }
    | { kind: "running" }
    | { kind: "replay"; response: StoredResponse }
  >;
  complete(
    scope: string,
    key: string,
    requestHash: string,
    claimToken: string,
    response: StoredResponse,
  ): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, StoredResponse>();
  public claim(scope: string, key: string, requestHash: string) {
    const composite = `${scope}:${key}`;
    const record = this.records.get(composite);
    if (!record) {
      const claimToken = randomUUID();
      this.records.set(composite, {
        requestHash,
        state: "running",
        claimToken,
      });
      return Promise.resolve({ kind: "claimed" as const, claimToken });
    }
    if (record.requestHash !== requestHash)
      return Promise.resolve({ kind: "conflict" as const });
    if (record.state === "running")
      return Promise.resolve({ kind: "running" as const });
    return Promise.resolve({ kind: "replay" as const, response: record });
  }
  public complete(
    scope: string,
    key: string,
    requestHash: string,
    claimToken: string,
    response: StoredResponse,
  ): Promise<void> {
    const current = this.records.get(`${scope}:${key}`);
    if (
      current?.requestHash !== requestHash ||
      current.claimToken !== claimToken
    )
      return Promise.reject(new Error("Stale in-memory idempotency lease"));
    this.records.set(`${scope}:${key}`, response);
    return Promise.resolve();
  }
}

interface EncodedResponseBody {
  base64: string;
}

function decodedBody(value: unknown): Uint8Array | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("base64" in value) ||
    typeof value.base64 !== "string"
  )
    return undefined;
  return Uint8Array.from(Buffer.from(value.base64, "base64"));
}

/** Durable store for Vercel/serverless runtimes; records survive process churn. */
export class DatabaseIdempotencyStore implements IdempotencyStore {
  public constructor(
    private readonly db: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async claim(scope: string, key: string, requestHash: string) {
    const claim = await withInternalTransaction(
      this.db,
      `idempotency:claim:${key}`,
      (transaction) =>
        claimIdempotencyKey(transaction, {
          scope,
          key,
          requestHash,
          now: this.now(),
        }),
    );
    if (claim.kind === "in_progress") return { kind: "running" as const };
    if (claim.kind === "claimed")
      return { kind: "claimed" as const, claimToken: claim.lockToken };
    if (claim.kind === "conflict") return claim;
    const body = decodedBody(claim.response.body);
    return {
      kind: "replay" as const,
      response: {
        requestHash,
        state: "complete" as const,
        status: claim.response.status,
        headers: claim.response.headers,
        ...(body ? { body } : {}),
      },
    };
  }

  public async complete(
    scope: string,
    key: string,
    requestHash: string,
    claimToken: string,
    response: StoredResponse,
  ) {
    const body: EncodedResponseBody | undefined = response.body
      ? { base64: Buffer.from(response.body).toString("base64") }
      : undefined;
    await withInternalTransaction(
      this.db,
      `idempotency:complete:${key}`,
      (transaction) =>
        completeIdempotencyKey(
          transaction,
          { scope, key, requestHash, lockToken: claimToken },
          {
            status: response.status ?? 200,
            headers: response.headers ?? {},
            body,
          },
        ),
    );
  }
}

export const idempotencyMiddleware = (store: IdempotencyStore) =>
  createMiddleware<{ Variables: ApiVariables }>(async (context, next) => {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(context.req.method) ||
      context.req.path.startsWith("/v1/webhooks/")
    ) {
      await next();
      return;
    }
    const requestContext = context.get("requestContext");
    const parsedKey = IdempotencyKeySchema.safeParse(
      context.req.header("idempotency-key"),
    );
    if (!parsedKey.success)
      throw new ProblemError({
        type: "https://clockwork.test/problems/idempotency",
        title: "Idempotency key required",
        status: 400,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        requestId: requestContext.requestId,
        retryable: false,
      });

    const raw = new Uint8Array(await context.req.raw.clone().arrayBuffer());
    const requestHash = createHash("sha256")
      .update(context.req.method)
      .update(new URL(context.req.url).pathname)
      .update(new URL(context.req.url).search)
      .update(raw)
      .digest("hex");
    const scope = `${requestContext.authorization?.userId ?? "anonymous"}:${context.req.path}`;
    const claim = await store.claim(scope, parsedKey.data, requestHash);
    if (claim.kind === "conflict")
      throw new ProblemError({
        type: "https://clockwork.test/problems/idempotency",
        title: "Idempotency key conflict",
        status: 409,
        code: "IDEMPOTENCY_KEY_CONFLICT",
        requestId: requestContext.requestId,
        retryable: false,
      });
    if (claim.kind === "running")
      throw new ProblemError({
        type: "https://clockwork.test/problems/idempotency",
        title: "Request already in progress",
        status: 409,
        code: "IDEMPOTENCY_IN_PROGRESS",
        requestId: requestContext.requestId,
        retryable: true,
      });
    if (claim.kind === "replay") {
      const headers = new Headers(claim.response.headers);
      headers.set("idempotency-replayed", "true");
      return new Response(
        claim.response.body
          ? Uint8Array.from(claim.response.body).buffer
          : null,
        {
          status: claim.response.status ?? 200,
          headers,
        },
      );
    }

    await next();
    const responseBody = new Uint8Array(
      await context.res.clone().arrayBuffer(),
    );
    await store.complete(scope, parsedKey.data, requestHash, claim.claimToken, {
      requestHash,
      state: "complete",
      status: context.res.status,
      headers: Object.fromEntries(context.res.headers),
      body: responseBody,
    });
    return undefined;
  });
