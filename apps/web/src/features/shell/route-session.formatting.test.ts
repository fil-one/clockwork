import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_PERSONA_HEADER,
  demoAccountIds,
} from "@clockwork/testing/personas";

import type * as AuthSession from "@/src/auth/session";
import type * as DemoPersona from "@/src/auth/demo-persona";

const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(requestHeaders),
  cookies: () => Promise.resolve(new Map()),
}));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));
vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: vi.fn() }));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("@/src/auth/release-proof", () => ({
  releaseProofConfiguration: () => null,
}));
vi.mock("@/src/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthSession>()),
  explicitDemoIdentityEnabled: () => true,
  getCommerceSession: vi.fn(),
}));
vi.mock("@/src/auth/demo-persona", async (importOriginal) => ({
  ...(await importOriginal<typeof DemoPersona>()),
  demoPersonaSurfacesEnabled: () => true,
}));

const { getRouteSession } = await import("./route-session");

beforeEach(() => {
  requestHeaders.clear();
  delete process.env.WORKOS_API_KEY;
  delete process.env.WORKOS_CLIENT_ID;
  delete process.env.WORKOS_COOKIE_PASSWORD;
});

/**
 * The persona catalog has carried a `locale` and a `timeZone` per persona since
 * it was written and nothing read them, which is why every dashboard rendered
 * `America/New_York`. These assert the values actually travel, not that a field
 * of the right name exists.
 */
describe("route session formatting", () => {
  it("carries the acting persona's own locale and zone", async () => {
    requestHeaders.set(DEMO_PERSONA_HEADER, "reseller");

    const session = await getRouteSession("partner");

    expect(session.locale).toBe("en-GB");
    expect(session.timeZone).toBe("Europe/London");
  });

  it("distinguishes personas rather than collapsing them onto one zone", async () => {
    requestHeaders.set(DEMO_PERSONA_HEADER, "endClient");

    const session = await getRouteSession("customer");

    expect(session.timeZone).toBe("America/Los_Angeles");
  });

  it("falls back to a zone every reader can interpret, not a local one", async () => {
    const session = await getRouteSession("customer");

    // No persona resolves, so nothing states a preference. UTC is the only
    // answer that is the same fact for everyone, and every surface labels it.
    expect(session.timeZone).toBe("UTC");
    expect(session.locale).toBe("en-US");
  });

  /**
   * The non-persona UI shard exercises the role-header fallback. Its session
   * used legacy `100…` accounts after the explicit demo projection moved to
   * the catalog's tenant-scoped `110…` accounts, so every customer and partner
   * collection was empty even though both sides were individually valid.
   */
  it("scopes fallback sessions to the accounts that own demo projections", async () => {
    const customer = await getRouteSession("customer");
    const partner = await getRouteSession("partner");

    expect(customer.effectiveAccountId).toBe(demoAccountIds.direct);
    expect(partner.effectiveAccountId).toBe(demoAccountIds.reseller);
  });
});
