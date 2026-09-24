import type { MessageId } from "@/src/i18n";

import {
  apiReferenceOperations,
  type ReferenceOperation,
} from "./api-reference";

/**
 * How each published operation is actually authenticated.
 *
 * WHY THIS MODULE EXISTS. The reference used to answer "52 of 59 operations
 * attach no security requirement" with one hand-written clause: "each handler
 * resolves a permission and an account scope before it runs." The count was
 * derived and right. The clause was prose, bound to no evidence and no test,
 * and false for ten of the fifty-two -- the six `/v1/webhooks/` routes
 * authenticate by provider signature and never call `requirePermission`,
 * `POST /v1/lifecycle/registrations` authenticates a bootstrap token and is the
 * one API path the browser proxy serves without a session, and the three lane
 * status endpoints resolve nothing at all. An integrator makes security
 * decisions on a sentence like that.
 *
 * So the page no longer asserts one mechanism for everything. It publishes the
 * mechanism PER ROUTE CLASS, and the classification is checked against the
 * handlers rather than described: `route-authentication.test.ts` parses every
 * `app.openapi(route, handler)` registration in `packages/api/src/routes/**`,
 * reads which of `requirePermission`, `verifyAndClaimWebhook` or the
 * registration bootstrap the handler actually calls, and fails if any operation
 * here is filed under a mechanism its handler does not implement. A route added
 * without any of the three lands in the default class and fails that test
 * immediately, which is the direction that matters.
 *
 * WHY THE RULES BELOW ARE SHAPES AND NOT A COPIED LIST. The page runs in a
 * deployed Next.js server, where `packages/api/src/routes/*.ts` is not on disk;
 * only the built contract is. So the classification at render time is a
 * function of the contract -- a path prefix and two small path tables -- and the
 * test is what holds that function to the source. A copied per-operation table
 * would be the second list this repository keeps getting burned by.
 */

export type AuthenticationMechanism =
  | "declared-scheme"
  | "session-and-permission"
  | "provider-signature"
  | "bootstrap-token"
  | "none";

/**
 * Inbound provider callbacks. The prefix is the real rule and not a convenience:
 * `packages/api/src/middleware/security.ts` and
 * `packages/api/src/middleware/idempotency.ts` both exempt this namespace by
 * `startsWith`, and `apps/web/proxy.ts` routes around AuthKit by the same test,
 * so a route placed under it is exempted by the act of naming it.
 */
export const providerSignaturePathPrefix = "/v1/webhooks/";

/** `METHOD path`, the key this module identifies an operation by. */
export function operationKey(operation: {
  readonly method: string;
  readonly path: string;
}): string {
  return `${operation.method} ${operation.path}`;
}

/**
 * Operations that authenticate a caller who has no session, by a secret in the
 * request body rather than by a cookie.
 */
export const bootstrapTokenOperations: readonly string[] = [
  "POST /v1/lifecycle/registrations", // i18n-exempt: operation key (HTTP method and contract path), an identifier
];

/**
 * Operations whose handler authenticates nobody. Naming them is the point: the
 * alternative is a sentence that quietly averages them in with the rest.
 */
export const unauthenticatedOperations: readonly string[] = [
  "GET /v1/core/status", // i18n-exempt: operation key (HTTP method and contract path), an identifier
  "GET /v1/lifecycle/status", // i18n-exempt: operation key (HTTP method and contract path), an identifier
  "GET /v1/system/status", // i18n-exempt: operation key (HTTP method and contract path), an identifier
];

export function authenticationMechanism(
  operation: ReferenceOperation,
): AuthenticationMechanism {
  if (operation.security.length > 0) return "declared-scheme";
  if (operation.path.startsWith(providerSignaturePathPrefix))
    return "provider-signature";
  const key = operationKey(operation);
  if (bootstrapTokenOperations.includes(key)) return "bootstrap-token";
  if (unauthenticatedOperations.includes(key)) return "none";
  return "session-and-permission";
}

export interface AuthenticationClass {
  readonly mechanism: AuthenticationMechanism;
  /** Heading. What the caller must present. */
  readonly title: MessageId;
  /**
   * "{count} by browser session and a permission check": one list item of the
   * count summary, counted at render time and joined with `Intl.ListFormat`.
   */
  readonly summary: MessageId;
  /** What the handler does with it, in one sentence, and what it does not. */
  readonly detail: MessageId;
  readonly operations: readonly ReferenceOperation[];
}

/**
 * The words for each class, as message IDs so the page reads in the reader's
 * language (`platform-developers.ts`). The clauses that make a checkable claim
 * -- the CSRF and idempotency-key exemption, the registrant's email and
 * business domain, no account data, what the proxy serves -- are checked
 * against the code by `route-authentication.test.ts`, and every translation
 * has to keep those claims exactly, negation and scope included.
 */
const classDetail: Readonly<
  Record<
    AuthenticationMechanism,
    { title: MessageId; summary: MessageId; detail: MessageId }
  >
> = {
  "declared-scheme": {
    title: "platform.developers.class.declaredScheme.title",
    summary: "platform.developers.class.declaredScheme.summary",
    detail: "platform.developers.class.declaredScheme.detail",
  },
  "session-and-permission": {
    title: "platform.developers.class.sessionAndPermission.title",
    summary: "platform.developers.class.sessionAndPermission.summary",
    detail: "platform.developers.class.sessionAndPermission.detail",
  },
  "provider-signature": {
    title: "platform.developers.class.providerSignature.title",
    summary: "platform.developers.class.providerSignature.summary",
    detail: "platform.developers.class.providerSignature.detail",
  },
  "bootstrap-token": {
    title: "platform.developers.class.bootstrapToken.title",
    summary: "platform.developers.class.bootstrapToken.summary",
    detail: "platform.developers.class.bootstrapToken.detail",
  },
  none: {
    title: "platform.developers.class.none.title",
    summary: "platform.developers.class.none.summary",
    detail: "platform.developers.class.none.detail",
  },
};

/** Display order: the classes an integrator most needs to see first. */
const mechanismOrder: readonly AuthenticationMechanism[] = [
  "session-and-permission",
  "provider-signature",
  "bootstrap-token",
  "none",
  "declared-scheme",
];

export function authenticationClasses(
  operations: readonly ReferenceOperation[] = apiReferenceOperations(),
): readonly AuthenticationClass[] {
  const buckets = new Map<AuthenticationMechanism, ReferenceOperation[]>();
  for (const operation of operations) {
    const mechanism = authenticationMechanism(operation);
    const bucket = buckets.get(mechanism);
    if (bucket) bucket.push(operation);
    else buckets.set(mechanism, [operation]);
  }
  return mechanismOrder.flatMap((mechanism) => {
    const bucket = buckets.get(mechanism);
    if (!bucket || bucket.length === 0) return [];
    return [
      {
        mechanism,
        ...classDetail[mechanism],
        operations: [...bucket].sort((left, right) =>
          operationKey(left).localeCompare(operationKey(right)),
        ),
      },
    ];
  });
}

/**
 * The classes small enough to publish operation by operation. A reader can
 * check "is the endpoint I am about to call one of the unusual ones?" against a
 * list rather than against an adjective.
 */
export function enumerableAuthenticationClasses(
  operations: readonly ReferenceOperation[] = apiReferenceOperations(),
): readonly AuthenticationClass[] {
  return authenticationClasses(operations).filter(
    (entry) =>
      entry.mechanism === "provider-signature" ||
      entry.mechanism === "bootstrap-token" ||
      entry.mechanism === "none",
  );
}
