import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { apiReferenceOperations } from "./api-reference";
import {
  type AuthenticationMechanism,
  authenticationClasses,
  authenticationMechanism,
  bootstrapTokenOperations,
  operationKey,
  providerSignaturePathPrefix,
  unauthenticatedOperations,
} from "./route-authentication";

/**
 * This suite is the whole reason the page is allowed to say anything about
 * authentication.
 *
 * WHAT IT REPLACED. The reference published one sentence about the fifty-two
 * operations that declare no security scheme: "each handler resolves a
 * permission and an account scope before it runs." Nothing checked it, and it
 * was false for ten of them. The fix is not a better sentence; it is that the
 * classification the page renders is now compared, operation by operation,
 * against what the handlers actually call.
 *
 * HOW THE GROUND TRUTH IS TAKEN. Every route registration in
 * `packages/api/src/routes/**` has the same two-part shape -- a
 * `const x = createRoute({ method, path })` and an `app.openapi(x, handler)` --
 * so the handler body for a given method and path is recoverable by reading the
 * source. Whether that body calls `requirePermission`, `verifyAndClaimWebhook`
 * or the registration bootstrap is then a fact about the code rather than a
 * description of it.
 *
 * CONFIRMED TO FAIL AGAINST THE CLAIM IT REPLACES. Editing
 * `authenticationMechanism` to return "session-and-permission" for everything
 * without a declared scheme -- which is exactly what the withdrawn prose
 * asserted -- failed 11 assertions in this file: one for each of
 * `POST /v1/lifecycle/registrations`, the six webhook routes and the three lane
 * status endpoints, plus the summary at the bottom of this file. Those ten
 * operations are the ten the sentence was wrong about, and the run reproduced
 * that list exactly.
 */

function workspaceRoot(): string {
  let directory = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Workspace root was not found above the test directory");
    directory = parent;
  }
}

const repositoryRoot = workspaceRoot();

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

const routeSourcePaths = [
  "packages/api/src/routes/core/index.ts",
  "packages/api/src/routes/core/payg-offers.ts",
  "packages/api/src/routes/lifecycle/index.ts",
  "packages/api/src/routes/lifecycle/notifications.ts",
  "packages/api/src/routes/system/index.ts",
  "packages/api/src/routes/system/external-gates.ts",
] as const;

/**
 * The mechanism a handler implements, read off its body.
 *
 * The order is a precedence, not a preference: a handler that both verifies a
 * signature and resolves a permission would be reported as the stricter of the
 * two, and today none does.
 */
function mechanismInSource(handlerBody: string): AuthenticationMechanism {
  if (handlerBody.includes("requirePermission("))
    return "session-and-permission";
  if (handlerBody.includes("verifyAndClaimWebhook("))
    return "provider-signature";
  // The registration handler verifies a bootstrap token against the
  // registrant's email and domain. The lane status handler merely REPORTS
  // whether a bootstrap is configured, so the call is what distinguishes them.
  if (
    handlerBody.includes("registrationBootstrap") &&
    /bootstrap\.verify\(/.test(handlerBody)
  )
    return "bootstrap-token";
  return "none";
}

interface SourceRoute {
  readonly key: string;
  readonly mechanism: AuthenticationMechanism;
  readonly source: string;
  readonly body: string;
}

function routesInSource(): readonly SourceRoute[] {
  const found: SourceRoute[] = [];
  for (const path of routeSourcePaths) {
    const source = read(path);
    const declarations = new Map<string, string>();
    for (const match of source.matchAll(
      /const (\w+) = createRoute\(\{([\s\S]*?)\n\}\);/g,
    )) {
      const method = /method: "(\w+)"/.exec(match[2] ?? "");
      const routePath = /path: "([^"]+)"/.exec(match[2] ?? "");
      if (method?.[1] && routePath?.[1])
        declarations.set(
          match[1] ?? "",
          `${method[1].toUpperCase()} ${routePath[1]}`,
        );
    }
    const registrations = [...source.matchAll(/app\.openapi\((\w+),/g)];
    registrations.forEach((registration, index) => {
      const key = declarations.get(registration[1] ?? "");
      if (!key) return;
      const start = registration.index ?? 0;
      const end = registrations[index + 1]?.index ?? source.length;
      found.push({
        key,
        mechanism: mechanismInSource(source.slice(start, end)),
        source: path,
        body: source.slice(start, end),
      });
    });
  }
  return found;
}

const sourceRoutes = routesInSource();
const sourceByKey = new Map(sourceRoutes.map((route) => [route.key, route]));
const sourceBodyByKey = new Map(
  sourceRoutes.map((route) => [route.key, route.body]),
);

describe("the published mechanism is the mechanism the handler implements", () => {
  it("recovers a handler for every operation the contract declares without a security scheme", () => {
    // Guard the guard. If the parser silently stopped matching -- a route file
    // renamed, a registration written differently -- every comparison below
    // would pass vacuously against an empty map.
    const undeclared = apiReferenceOperations().filter(
      (operation) => operation.security.length === 0,
    );
    const missing = undeclared
      .map((operation) => operationKey(operation))
      .filter((key) => !sourceByKey.has(key));
    expect(
      missing,
      `no handler was found in ${routeSourcePaths.join(", ")} for these operations, so their classification is unchecked`,
    ).toEqual([]);
    expect(undeclared.length).toBeGreaterThan(0);
  });

  it.each(
    apiReferenceOperations()
      .filter((operation) => operation.security.length === 0)
      .map((operation) => [operationKey(operation), operation] as const),
  )(
    "%s is filed under the mechanism its handler implements",
    (key, operation) => {
      const inSource = sourceByKey.get(key);
      expect(inSource).toBeDefined();
      expect(
        authenticationMechanism(operation),
        `the reference files ${key} as ${authenticationMechanism(operation)}, but its handler in ${inSource?.source} implements ${inSource?.mechanism}`,
      ).toBe(inSource?.mechanism);
    },
  );

  it("files an operation that declares a scheme under that scheme", () => {
    for (const operation of apiReferenceOperations().filter(
      (candidate) => candidate.security.length > 0,
    ))
      expect(authenticationMechanism(operation)).toBe("declared-scheme");
  });

  it("classifies every published operation exactly once", () => {
    const operations = apiReferenceOperations();
    const classified = authenticationClasses().flatMap(
      (entry) => entry.operations,
    );
    expect(classified).toHaveLength(operations.length);
    expect(new Set(classified.map((entry) => operationKey(entry))).size).toBe(
      operations.length,
    );
  });

  it("keeps the named exception lists to the operations that are still exceptions", () => {
    // A route that stops being an exception has to be removed from these
    // lists, not left to be described as one.
    for (const key of [
      ...bootstrapTokenOperations,
      ...unauthenticatedOperations,
    ])
      expect(
        sourceByKey.has(key),
        `${key} is named as an exception but no handler by that name exists any more`,
      ).toBe(true);
    for (const key of bootstrapTokenOperations)
      expect(sourceByKey.get(key)?.mechanism).toBe("bootstrap-token");
    for (const key of unauthenticatedOperations)
      expect(sourceByKey.get(key)?.mechanism).toBe("none");
  });

  it("reports the ten operations the withdrawn sentence was wrong about", () => {
    // The refutation, kept as an assertion so it cannot quietly stop being
    // true: these are the operations for which "each handler resolves a
    // permission and an account scope" was false.
    const notSessionAndPermission = apiReferenceOperations()
      .filter(
        (operation) =>
          operation.security.length === 0 &&
          authenticationMechanism(operation) !== "session-and-permission",
      )
      .map((operation) => operationKey(operation))
      .sort();
    expect(notSessionAndPermission).toEqual([
      "GET /v1/core/status",
      "GET /v1/lifecycle/status",
      "GET /v1/system/status",
      "POST /v1/lifecycle/registrations",
      "POST /v1/webhooks/esign",
      "POST /v1/webhooks/marketplaces/{provider}",
      "POST /v1/webhooks/provisioning",
      "POST /v1/webhooks/stripe",
      "POST /v1/webhooks/support/{provider}",
      "POST /v1/webhooks/workos",
    ]);
  });
});

describe("the sentence each class publishes is true of the code", () => {
  /**
   * `classDetail` in `route-authentication.ts` is the one place on this surface
   * where a sentence is written rather than counted. Each clause of it that
   * makes a checkable claim is checked here, because a sentence bound to
   * nothing is the defect this whole file exists to have fixed.
   */
  it("exempts the webhook namespace from CSRF and from the idempotency key, by prefix", () => {
    for (const path of [
      "packages/api/src/middleware/security.ts",
      "packages/api/src/middleware/idempotency.ts",
    ])
      expect(
        read(path),
        `${path} no longer exempts the webhook namespace, so "deliberately exempt from the CSRF and idempotency-key checks" is no longer true`,
      ).toContain(`startsWith("${providerSignaturePathPrefix}")`);
  });

  it("verifies a registration token against the registrant's email and business domain", () => {
    const source = read("packages/api/src/routes/lifecycle/index.ts");
    const verification = /bootstrap\.verify\(\{([\s\S]*?)\}\)/.exec(
      source,
    )?.[1];
    expect(verification).toBeDefined();
    for (const field of ["token", "email", "businessDomain"])
      expect(
        verification,
        `the registration handler no longer passes ${field}, which the published sentence says it verifies against`,
      ).toContain(field);
  });

  it("reads nothing account-shaped in the handlers it publishes as unauthenticated", () => {
    // "return no tenant data" is the claim. A status handler that started
    // reading a path parameter or an account id would break it.
    for (const key of unauthenticatedOperations) {
      const body = sourceBodyByKey.get(key);
      expect(body, `no handler body was recovered for ${key}`).toBeDefined();
      for (const forbidden of ["accountId", 'req.valid("param")', "req.query("])
        expect(
          body?.includes(forbidden),
          `${key} is published as returning no tenant data, but its handler reads ${forbidden}`,
        ).toBe(false);
    }
  });
});

describe("what the proxy serves without a session", () => {
  /**
   * Two of the classes above make a claim about `apps/web/proxy.ts` -- the
   * bootstrap and webhook routes are reachable without signing in, the status
   * endpoints are not. That is the kind of clause the withdrawn sentence was:
   * plausible, published, and bound to nothing. It is bound here.
   */
  const proxy = read("apps/web/proxy.ts");

  it("serves the registration endpoint to an anonymous caller and no other API path", () => {
    const list = /unauthenticatedPaths: \[([\s\S]*?)\]/.exec(proxy)?.[1] ?? "";
    const paths = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(paths).toContain("/api/v1/lifecycle/registrations");
    expect(
      paths.filter((path) => path?.startsWith("/api/")),
      "another API path became anonymous; the reference states there is exactly one",
    ).toEqual(["/api/v1/lifecycle/registrations"]);
    for (const key of bootstrapTokenOperations)
      expect(`/api${key.split(" ")[1] ?? ""}`).toBe(
        "/api/v1/lifecycle/registrations",
      );
  });

  it("routes the webhook namespace around the identity provider entirely", () => {
    expect(proxy).toContain('startsWith("/api/v1/webhooks/")');
    expect(proxy).toContain("workosProxy && !isWebhook");
  });

  it("puts sign-in in front of the status endpoints", () => {
    const list = /unauthenticatedPaths: \[([\s\S]*?)\]/.exec(proxy)?.[1] ?? "";
    for (const key of unauthenticatedOperations)
      expect(
        list.includes(key.split(" ")[1] ?? ""),
        `${key} became anonymous at the proxy; the reference says the proxy still requires a session for it`,
      ).toBe(false);
  });
});
