import { afterEach, describe, expect, it, vi } from "vitest";

import { demoJourneys } from "@clockwork/testing/demo-journeys";

import { translatorFor } from "@/src/i18n/catalogs";
import { locales } from "@/src/i18n/locales";

import {
  demoJourneyForPersona,
  demoJourneyView,
  demoPersonaCatalog,
  demoPersonaChoiceLabel,
  demoPersonaIntent,
  demoPersonaJobTitle,
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
    expect(demoJourneyView("directBuyer", translatorFor("en"))).toEqual({
      title: "Review and accept a renewal",
      steps: [
        {
          route: "/dashboard",
          intent: "Open the renewal action from the account overview.",
        },
        {
          route: "/quotes/quote-direct-renewal-v2",
          intent: "Review the issued version and proceed to acceptance.",
        },
      ],
    });
  });

  it("keeps every journey inside the portal the persona starts in", () => {
    // A step may go deeper than the start route, but a customer journey must
    // never open an internal page, and neither may a partner journey.
    const portalOf = (route: string) =>
      route.startsWith("/internal")
        ? "internal"
        : route.startsWith("/partner")
          ? "partner"
          : "customer";

    for (const persona of demoPersonaCatalog) {
      const journey = demoJourneyForPersona(persona.key);
      const start = portalOf(demoPersonaStartRoute(persona.key));
      expect(journey?.steps.map((step) => portalOf(step.route))).toEqual(
        journey?.steps.map(() => start),
      );
    }
  });
});

describe("demo persona copy", () => {
  // James's Portuguese session showed English job titles and tasks on the
  // persona picker: they were fixture strings, not messages.
  it("words the persona picker and demo controls in the reader's language", () => {
    const t = translatorFor("pt");
    const mara = demoPersonaCatalog.find(({ key }) => key === "directBuyer");
    expect(mara && demoPersonaChoiceLabel(mara, t)).toBe(
      "Mara Voss · Diretora de operações",
    );
    expect(demoPersonaIntent("directBuyer", t)).toBe(
      "Aceitar a cotação de renovação antes do início do aviso prévio.",
    );
    // The account is a name: a fact inside the sentence, never translated.
    expect(demoJourneyView("distributor", t)?.steps[0]?.intent).toBe(
      "Abrir o registro do cliente final Cobalt Orchard GmbH.",
    );
  });

  it("gives every persona and every journey step its own text in every language", () => {
    for (const locale of locales) {
      const t = translatorFor(locale);
      for (const persona of demoPersonaCatalog) {
        const jobTitle = demoPersonaJobTitle(persona.key, t);
        const intent = demoPersonaIntent(persona.key, t);
        // A missing message renders its ID; a message must never do that.
        expect(jobTitle, `${locale} ${persona.key}`).not.toMatch(/^demo\./u);
        expect(intent, `${locale} ${persona.key}`).not.toMatch(/^demo\./u);
        expect(demoPersonaChoiceLabel(persona, t)).toContain(
          persona.displayName,
        );
        const view = demoJourneyView(persona.key, t);
        const journey = demoJourneyForPersona(persona.key);
        expect(view?.steps.map(({ route }) => route)).toEqual(
          journey?.steps.map(({ route }) => route),
        );
        for (const text of [
          view?.title,
          ...(view?.steps ?? []).map((s) => s.intent),
        ])
          expect(text, `${locale} ${persona.key}`).not.toMatch(/^demo\.|\{/u);
      }
    }
    // Every journey belongs to exactly one persona, so the views cover them all.
    expect(
      new Set(Object.values(demoJourneys).map((j) => j.persona)).size,
    ).toBe(Object.keys(demoJourneys).length);
  });

  it("keeps the English source out of the translated picker", () => {
    const english = translatorFor("en");
    for (const locale of locales.filter((locale) => locale !== "en")) {
      const t = translatorFor(locale);
      for (const persona of demoPersonaCatalog) {
        expect(demoPersonaJobTitle(persona.key, t)).not.toBe(
          demoPersonaJobTitle(persona.key, english),
        );
        expect(demoPersonaIntent(persona.key, t)).not.toBe(
          demoPersonaIntent(persona.key, english),
        );
      }
    }
  });
});
