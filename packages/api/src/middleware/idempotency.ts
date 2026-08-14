import { createHash, randomUUID } from "node:crypto";

import { IdempotencyKeySchema, ProblemError } from "@clockwork/contracts";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  withInternalTransaction,
} from "@clockwork/db";
import type { RuntimeDatabase } from "@clockwork/db";
import { createMiddleware } from "hono/factory";

import type { ApiVariables } from "../context";

interface StoredResponse {
  requestHash: string;
  state: "running" | "complete" | "released";
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
  /**
   * Abandon a claim without recording an outcome; see `cacheableStatus`.
   * Optional only so that a store which rejects every call -- the stub used
   * when no durable database is configured in production -- need not implement
   * it. Omitting it leaves the claim to lapse on its own lock, which is slower
   * but is still never a cached failure.
   */
  release?(
    scope: string,
    key: string,
    requestHash: string,
    claimToken: string,
  ): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, StoredResponse>();
  public claim(scope: string, key: string, requestHash: string) {
    const composite = `${scope}:${key}`;
    const record = this.records.get(composite);
    if (!record) return Promise.resolve(this.take(composite, requestHash));
    if (record.requestHash !== requestHash)
      return Promise.resolve({ kind: "conflict" as const });
    // A released record is re-claimable, but it still holds the request hash,
    // so a changed body under the same key conflicts as before.
    if (record.state === "released")
      return Promise.resolve(this.take(composite, requestHash));
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
  public release(
    scope: string,
    key: string,
    requestHash: string,
    claimToken: string,
  ): Promise<void> {
    const composite = `${scope}:${key}`;
    const current = this.records.get(composite);
    if (
      current?.requestHash !== requestHash ||
      current.claimToken !== claimToken
    )
      return Promise.reject(new Error("Stale in-memory idempotency lease"));
    this.records.set(composite, { requestHash, state: "released" });
    return Promise.resolve();
  }
  private take(composite: string, requestHash: string) {
    const claimToken = randomUUID();
    this.records.set(composite, { requestHash, state: "running", claimToken });
    return { kind: "claimed" as const, claimToken };
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

  public async release(
    scope: string,
    key: string,
    requestHash: string,
    claimToken: string,
  ) {
    await withInternalTransaction(
      this.db,
      `idempotency:release:${key}`,
      (transaction) =>
        releaseIdempotencyKey(
          transaction,
          { scope, key, requestHash, lockToken: claimToken },
          this.now(),
        ),
    );
  }
}

/**
 * An unauthenticated caller still needs idempotency, but it cannot be scoped to
 * a session that does not exist. A binding names the one secret such a request
 * carries in its own body: something the principal already proved knowledge of,
 * unguessable by a third party, and stable across that principal's own retries.
 * Anything attacker-chosen (client IP, user agent, the CSRF double-submit
 * cookie) is not a principal and must never appear here.
 */
export interface AnonymousScopeBinding {
  method: string;
  path: string;
  /** The request-bound secret, or null when it cannot be determined. */
  extract: (body: Uint8Array) => string | null;
}

function jsonStringField(field: string, minimumLength: number) {
  return (body: Uint8Array): string | null => {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!parsed || typeof parsed !== "object") return null;
    const value = (parsed as Record<string, unknown>)[field];
    return typeof value === "string" && value.length >= minimumLength
      ? value
      : null;
  };
}

/**
 * The list is explicit so that a route reachable without a session cannot
 * inherit a shared namespace by omission -- adding one is a reviewed decision
 * about which secret identifies its callers, not a default.
 */
export const anonymousScopeBindings: readonly AnonymousScopeBinding[] = [
  {
    // `registrationToken` is a server-issued secret of at least 32 characters
    // that the handler verifies against the registrant's email and business
    // domain, so it identifies exactly one prospective registrant.
    method: "POST",
    path: "/v1/lifecycle/registrations",
    extract: jsonStringField("registrationToken", 32),
  },
];

function anonymousScopeSecret(
  bindings: readonly AnonymousScopeBinding[],
  method: string,
  path: string,
  body: Uint8Array,
): string | null {
  const binding = bindings.find(
    (entry) => entry.method === method && entry.path === path,
  );
  if (!binding) return null;
  try {
    return binding.extract(body);
  } catch {
    // A body that will not parse identifies nobody. Denying is the only honest
    // answer: falling back to a shared literal scope, or to a random one that
    // silently disables idempotency, both read as protection without being it.
    return null;
  }
}

/**
 * Only outcomes that are final for these exact request bytes may be frozen for
 * the record's twenty-four hour lifetime.
 *
 * 2xx and 3xx describe the resource's settled state, which is the whole point
 * of replaying them. 4xx is deterministic for identical bytes -- the same
 * request is rejected the same way -- so replaying the rejection is correct and
 * stops a caller re-driving a validation-failing request under one key. 408,
 * 425 and 429 are excluded because they are statements about timing rather than
 * about the request, and the caller is explicitly told to retry.
 *
 * 5xx is never cached: it describes the server at one instant, and caching it
 * converts a dependency blip into a twenty-four hour outage for that key, which
 * is the exact opposite of the `retryable: true` the problem body carries. The
 * check is an allow-list, so a status nobody has considered yet is released
 * rather than frozen.
 *
 * The 409 IDEMPOTENCY_* denials never reach here; they are raised before the
 * claim is completed.
 */
function cacheableStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return false;
  return status >= 200 && status < 500;
}

export const idempotencyMiddleware = (
  store: IdempotencyStore,
  bindings: readonly AnonymousScopeBinding[] = anonymousScopeBindings,
) =>
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
    // There is no "anonymous" scope. Either the session names the principal, or
    // the request itself carries a secret that does; a caller we cannot name
    // gets no record at all, so nothing is written and nothing can be served.
    const authorization = requestContext.authorization;
    const anonymous = !authorization;
    const anonymousSecret = authorization
      ? null
      : anonymousScopeSecret(
          bindings,
          context.req.method,
          context.req.path,
          raw,
        );
    if (anonymous && !anonymousSecret)
      throw new ProblemError({
        type: "https://clockwork.test/problems/idempotency",
        title: "Idempotency scope could not be established",
        status: 403,
        code: "IDEMPOTENCY_SCOPE_UNRESOLVED",
        requestId: requestContext.requestId,
        retryable: false,
      });
    // The secret is hashed: `scope` is persisted in plaintext on the record.
    const scope = authorization
      ? `${authorization.userId}:${context.req.path}`
      : `anon:${createHash("sha256")
          .update(anonymousSecret ?? "")
          .digest("hex")}:${context.req.path}`;
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
      // Never hand a previous response back to a caller we could only identify
      // from the request itself. Deriving the scope from a request-bound secret
      // is a strong control, but it is not a session; if it is ever imperfect,
      // this is what stops one registrant reading another's account,
      // organization and user identifiers -- and their response headers, which
      // is the sneakier leak. The duplicate-side-effect guarantee survives:
      // the record still exists, so the handler does not run twice. What the
      // legitimate retrying registrant loses is the response body, which it now
      // has to fetch over an authenticated path -- a deliberate trade of a
      // little availability for confidentiality.
      if (anonymous) {
        context.header("idempotency-replayed", "true");
        throw new ProblemError({
          type: "https://clockwork.test/problems/idempotency",
          title: "Recorded response cannot be replayed",
          status: 409,
          code: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
          requestId: requestContext.requestId,
          retryable: false,
        });
      }
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
    const status = context.res.status;
    try {
      if (!cacheableStatus(status)) {
        // Release rather than complete, so the same key and the same bytes are
        // retryable at once while a different body still conflicts. The
        // handler's partial writes are not shielded by the record afterwards;
        // that is correct here because each lifecycle command runs inside one
        // transaction, so a throw rolls the whole thing back.
        await store.release?.(
          scope,
          parsedKey.data,
          requestHash,
          claim.claimToken,
        );
        return undefined;
      }
      await store.complete(
        scope,
        parsedKey.data,
        requestHash,
        claim.claimToken,
        anonymous
          ? // Status only. An anonymous record is never replayed as bytes, so
            // persisting the body or the headers would store a disclosure with
            // no reader.
            { requestHash, state: "complete", status }
          : {
              requestHash,
              state: "complete",
              status,
              headers: Object.fromEntries(context.res.headers),
              body: new Uint8Array(await context.res.clone().arrayBuffer()),
            },
      );
    } catch {
      // The handler already committed. A lease that lapsed while it ran (the
      // lock is thirty seconds) must not turn a successful mutation into a 500;
      // the record simply expires and the next retry re-enters the handler,
      // which is where it stood before the lease was taken.
    }
    return undefined;
  });
