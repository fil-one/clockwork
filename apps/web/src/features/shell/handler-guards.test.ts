import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every route handler and every server action must check who is calling
 * before it does anything, or say here why it does not need to. A handler
 * added without either fails this file, so a new endpoint cannot quietly open
 * to the seller role (or to anyone).
 *
 * The check is textual: a handler must call one of the repository's
 * authorization helpers, directly or through a function in the same file that
 * does. It proves a check is present, not that it is the right one; the
 * behavior is pinned by each handler's own tests.
 */

const web = process.cwd();

const guardCalls = [
  "requireStaffPermission(",
  "withStaffPermission(",
  "staffMayUse(",
  "rolesHavePermission(",
  "hasPermission(",
  "requirePermission(",
  "requireAudience(",
  "mndaStaff(",
  "roles.includes(",
  "roles.some(",
] as const;

/** Handlers that do not authorize a role, and what stands in for it. */
const routeExemptions: Readonly<
  Record<string, { reason: string; mustContain: string }>
> = {
  "app/api/[[...route]]/route.ts": {
    reason:
      "The Hono API: every route authorizes in packages/api through requirePermission and the domain authorize().",
    mustContain: "hono-app",
  },
  "app/api/experience/[[...segments]]/route.ts": {
    reason:
      "The experience API: handleExperienceRequest checks the audience per request (requireAudience).",
    mustContain: "handleExperienceRequest",
  },
  "app/access/mfa/verify/route.ts": {
    reason:
      "Verifies the signed-in person's own second factor; there is no role to check yet.",
    mustContain: "getVerifiedWorkosSession(",
  },
  "app/auth/callback/route.ts": {
    reason: "The identity provider's sign-in callback.",
    mustContain: "handleAuth",
  },
  "app/sign-in/route.ts": {
    reason: "Starts sign-in.",
    mustContain: "getSignInUrl",
  },
  "app/api/telemetry/route.ts": {
    reason:
      "Browser telemetry, accepted only with the signed ingest cookie and never returning data.",
    mustContain: "verifyTelemetryIngestCookie(",
  },
  "app/api/v1/webhooks/signwell/route.ts": {
    reason:
      "A provider callback, authenticated by the provider's signature, and treated only as a wakeup.",
    mustContain: "verifySignWellWakeup(",
  },
  "app/healthcheck/route.ts": {
    reason: "Liveness probe; returns no data.",
    mustContain: "export",
  },
  "app/developers/openapi.json/route.ts": {
    reason: "The public API description.",
    mustContain: "export",
  },
  "app/api/demo/orders/provision/route.ts": {
    reason: "Guided demo only.",
    mustContain: "demoDeployIdentityEnabled(",
  },
  "app/api/demo/projections/queues/refresh/route.ts": {
    reason: "Guided demo only.",
    mustContain: "demoDeployIdentityEnabled(",
  },
  "app/api/demo/reset/route.ts": {
    reason: "Guided demo only.",
    mustContain: "demoDeployOptIn",
  },
  "app/demo/access/submit/route.ts": {
    reason: "Guided demo access password.",
    mustContain: "demoAccessConfiguration(",
  },
  "app/demo/persona/route.ts": {
    reason: "Guided demo persona choice.",
    mustContain: "demoPersonaSurfacesEnabled(",
  },
  "app/demo/quote/[token]/respond/route.ts": {
    reason: "Guided demo client response.",
    mustContain: "demoDeployIdentityEnabled(",
  },
  "app/signing/demo-provider/complete/route.ts": {
    reason: "Guided demo signing provider.",
    mustContain: "demoExperienceEnabled(",
  },
};

/** Server actions that act only on the caller's own session. */
const actionExemptions: Readonly<Record<string, string>> = {
  "app/(experience)/settings/actions.ts#saveLanguage":
    "Stores the caller's own interface language in a cookie.",
  "src/auth/sign-out.ts#signOutCommerceSession": "Ends the caller's session.",
  "src/auth/actions.ts#switchCommerceAccount":
    "Switches among the caller's own memberships, which it re-reads.",
  "src/auth/actions.ts#chooseCommerceAccount":
    "Switches among the caller's own memberships, through switchCommerceAccount.",
  "src/auth/actions.ts#exitAssistedSession":
    "Ends the caller's own assisted session.",
  "src/auth/actions.ts#exitProviderAssistedSession":
    "Ends the caller's own provider-managed assisted session.",
  "src/features/customer-partner/acquisition/actions.ts#submitCustomerAcquisition":
    "A customer's own request; it checks the owner or admin membership.",
};

function files(directory: string, match: (name: string) => boolean): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path, match);
    return match(name) ? [relative(web, path).split("\\").join("/")] : [];
  });
}

/** Top-level functions of a module, by name, with their source text. */
function functions(source: string): Map<string, string> {
  const pattern =
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/gmu;
  const starts = [...source.matchAll(pattern)].map((match) => ({
    name: match[1] ?? match[2] ?? "",
    index: match.index ?? 0,
  }));
  return new Map(
    starts.map(({ name, index }, position) => [
      name,
      source.slice(index, starts[position + 1]?.index ?? source.length),
    ]),
  );
}

/** Function names in a module that reach a guard call, directly or locally. */
function guardedFunctions(source: string): Set<string> {
  const bodies = functions(source);
  const guarded = new Set(
    [...bodies]
      .filter(([, body]) => guardCalls.some((call) => body.includes(call)))
      .map(([name]) => name),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of bodies)
      if (
        !guarded.has(name) &&
        [...guarded].some((other) =>
          new RegExp(`\\b${other}\\(`, "u").test(body),
        )
      ) {
        guarded.add(name);
        grew = true;
      }
  }
  return guarded;
}

describe("route handlers", () => {
  const routes = files(join(web, "app"), (name) => name === "route.ts");

  it("finds the handlers it guards", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)("%s checks its caller or names why not", (path) => {
    const source = readFileSync(join(web, path), "utf8");
    const exemption = routeExemptions[path];
    if (exemption) {
      expect(source, exemption.reason).toContain(exemption.mustContain);
      return;
    }
    const handlers = [
      ...source.matchAll(
        /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/gu,
      ),
    ].map((match) => match[1] ?? "");
    expect(handlers.length, `${path} exports no handler`).toBeGreaterThan(0);
    const guarded = guardedFunctions(source);
    for (const handler of handlers)
      expect(
        guarded.has(handler),
        `${path} ${handler} calls no authorization helper`,
      ).toBe(true);
  });

  it("lists no exemption for a handler that no longer exists", () => {
    for (const path of Object.keys(routeExemptions))
      expect(routes).toContain(path);
  });
});

describe("server actions", () => {
  const modules = [
    ...files(join(web, "app"), (name) => /\.tsx?$/u.test(name)),
    ...files(join(web, "src"), (name) => /\.tsx?$/u.test(name)),
  ].filter(
    (path) =>
      !/\.(test|spec|stories)\.tsx?$/u.test(path) &&
      /^\s*["']use server["'];?/u.test(readFileSync(join(web, path), "utf8")),
  );
  const actions = modules.flatMap((path) => {
    const source = readFileSync(join(web, path), "utf8");
    return [...source.matchAll(/^export\s+async\s+function\s+(\w+)/gmu)].map(
      (match) => ({ path, name: match[1] ?? "", source }),
    );
  });

  it("finds the actions it guards", () => {
    expect(actions.length).toBeGreaterThan(15);
  });

  it.each(actions.map(({ path, name }) => `${path}#${name}`))(
    "%s checks its caller or names why not",
    (key) => {
      const action = actions.find(
        ({ path, name }) => `${path}#${name}` === key,
      );
      if (!action) throw new Error(`missing ${key}`);
      if (actionExemptions[key]) return;
      expect(
        guardedFunctions(action.source).has(action.name),
        `${key} calls no authorization helper`,
      ).toBe(true);
    },
  );

  it("lists no exemption for an action that no longer exists", () => {
    const keys = actions.map(({ path, name }) => `${path}#${name}`);
    for (const key of Object.keys(actionExemptions))
      expect(keys).toContain(key);
  });
});
