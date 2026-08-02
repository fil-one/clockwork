import { afterEach, describe, expect, it, vi } from "vitest";

import {
  demoJourneyForPersona,
  demoPersonaCatalog,
  demoPersonaMembership,
  demoPersonaStartRoute,
  demoPersonaSurfacesEnabled,
  resolveDemoPersona,
} from "./demo-persona";

afterEach(() => vi.unstubAllEnvs());

function demoDeployEnvironment(): void {
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
}

describe("demo persona resolution", () => {
  it("prefers the header over the cookie", () => {
    expect(
      resolveDemoPersona({ header: "internalOperator", cookie: "directBuyer" })
        ?.key,
    ).toBe("internalOperator");
  });

  it("keeps the legacy role header meaning by resolving no persona", () => {
    // Playwright suites send a commerce role here. It is never a persona key,
    // so the header decides on its own and a persona cookie cannot leak in.
    expect(
      resolveDemoPersona({ header: "partner_admin", cookie: "directBuyer" }),
    ).toBeUndefined();
  });

  it("falls back to the cookie only when no header is present", () => {
    expect(resolveDemoPersona({ cookie: "billingUser" })?.key).toBe(
      "billingUser",
    );
    expect(resolveDemoPersona({ header: "", cookie: "billingUser" })?.key).toBe(
      "billingUser",
    );
  });

  it("ignores an unknown cookie value", () => {
    expect(resolveDemoPersona({ cookie: "not-a-persona" })).toBeUndefined();
    expect(resolveDemoPersona({})).toBeUndefined();
  });
});

describe("demo persona surfaces flag", () => {
  it("stays closed without the deploy opt-in", () => {
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "");

    expect(demoPersonaSurfacesEnabled(process.env)).toBe(false);
  });

  it("opens on a deliberate fixture deploy", () => {
    demoDeployEnvironment();

    expect(demoPersonaSurfacesEnabled(process.env)).toBe(true);
  });

  it("refuses when a platform marker identifies production", () => {
    demoDeployEnvironment();
    vi.stubEnv("CLOCKWORK_ENV", "production");

    expect(demoPersonaSurfacesEnabled(process.env)).toBe(false);
  });
});

describe("demo persona identity", () => {
  it("gives every catalog persona a start route and a membership", () => {
    expect(demoPersonaCatalog).toHaveLength(9);
    for (const persona of demoPersonaCatalog) {
      expect(demoPersonaStartRoute(persona.key)).toMatch(/^\//);
      const membership = demoPersonaMembership(persona);
      expect(membership.userEmail).toBe(persona.email);
      expect(membership.userName).toBe(persona.displayName);
      expect(membership.accountId).toBe(persona.selectedAccountId);
      expect(membership.role).toBe(persona.role);
    }
  });

  it("annotates each persona with its journey", () => {
    expect(demoJourneyForPersona("directBuyer")?.title).toBe(
      "Direct buyer reviews and accepts a renewal",
    );
  });
});
