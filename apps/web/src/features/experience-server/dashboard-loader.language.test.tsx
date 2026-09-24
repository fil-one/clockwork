import { render } from "@testing-library/react";
import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { demoAccountIds } from "@clockwork/testing/personas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "@/src/i18n/locales";

import type { ExperienceAudience, ProjectionChannel } from "./model";
import type * as PortalViewLoader from "./portal-view-loader";

/** The request's interface language, as the language cookie would carry it. */
const request = vi.hoisted((): { language: Locale } => ({ language: "en" }));

vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  const { formattingLocales } = await import("@/src/i18n/locales");
  const settled = <T,>(value: T) =>
    Object.assign(Promise.resolve(value), { status: "fulfilled", value });
  return {
    getLocale: () => settled(request.language),
    getTranslations: () => settled(translatorFor(request.language)),
    getFormattingLocale: () => settled(formattingLocales[request.language]),
  };
});

const direct = demoAccountIds.direct;
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: () =>
    Promise.resolve({
      accountIds: [direct],
      selectedAccountId: direct,
      roles: ["customer_admin"],
    }),
}));

/**
 * The dashboard reads the real demo fixtures, through the real demo read
 * boundary, in the request's language: the obligations are whatever the
 * fixtures and the projection source make of them.
 */
vi.mock("./portal-view-loader", async (importOriginal) => {
  const original = await importOriginal<typeof PortalViewLoader>();
  const { ExplicitDemoProjectionSource } = await import("./projection-source");
  const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
  return {
    ...original,
    loadPortalRecords: async (
      audience: ExperienceAudience,
      channel: ProjectionChannel,
    ) => {
      const page = await source.list({
        session: {} as SessionClaims,
        audience,
        channel,
        accountId: direct,
        limit: 100,
        now: new Date("2026-09-23T12:00:00Z"),
        locale: request.language,
      });
      return {
        records: page.items,
        generatedAt: "2026-09-23T12:00:00.000Z",
        stale: false,
        recordCount: page.items.length,
        pagesRead: 1,
        truncated: false,
      };
    },
  };
});

import { CustomerDashboard } from "@/src/features/customer-partner/customer/customer-dashboard";

import {
  loadCustomerDashboardProjection,
  loadPartnerDashboardProjection,
} from "./dashboard-loader";

beforeEach(() => {
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "local");
});

afterEach(() => {
  vi.unstubAllEnvs();
  request.language = "en";
});

async function dashboardIn(language: Locale) {
  request.language = language;
  return loadCustomerDashboardProjection("Meridian Archive Labs");
}

const languages = ["en", "es", "fr", "de", "ja", "pt", "zh", "ar"] as const;

describe("the demo dashboard in every interface language", () => {
  it("lists the same obligations in the same order in every language", async () => {
    const english = (await dashboardIn("en")).obligations.map(
      (item) => item.id,
    );
    expect(english).toEqual([
      "invoice-meridian-overdue",
      "Q-2026-0184-v3",
      "INV-2026-0781",
      "quote-direct-renewal-v2",
      "renewal-0098",
    ]);
    for (const language of languages)
      expect(
        (await dashboardIn(language)).obligations.map((item) => item.id),
        language,
      ).toEqual(english);
  });

  it("writes the obligation chrome and the account agreement in Japanese", async () => {
    const dashboard = await dashboardIn("ja");
    expect(dashboard.obligations.map((item) => item.type)).toEqual([
      "請求書",
      "見積もり",
      "請求書",
      "見積もり",
      "通知期間と契約更新",
    ]);
    expect(dashboard.obligations[0]).toMatchObject({
      actionLabel: "請求書を確認",
      state: "期限超過・支払いの再試行が可能",
    });
    expect(dashboard.term).toMatchObject({
      title: "Meridian Archive Labs の年間契約期間",
      renewalState: "自動更新",
      // An executed agreement keeps the English title it was signed under.
      agreementLabel: "Cloud Service Agreement（バージョン 3.2）",
      renewalTone: "success",
    });
    expect(dashboard.capacity?.freshnessLabel).toMatch(/^使用状況データを/u);
    // Everything this lane writes: the chrome of every obligation, the rows
    // its own fixtures supply, and the agreement, service and usage panels.
    // (Q-2026-0184-v3 and INV-2026-0781 come from the commercial fixtures,
    // whose text is another lane's.)
    const own = {
      chrome: dashboard.obligations.map(({ type, actionLabel }) => ({
        type,
        actionLabel,
      })),
      rows: dashboard.obligations
        .filter((item) =>
          [
            "invoice-meridian-overdue",
            "quote-direct-renewal-v2",
            "renewal-0098",
          ].includes(item.id),
        )
        .map(({ title, detail, state }) => ({ title, detail, state })),
      term: dashboard.term,
      services: dashboard.services.map(({ name, detail }) => ({
        name,
        detail,
      })),
      capacity: dashboard.capacity,
      activity: dashboard.activity.map(({ title, detail, occurredLabel }) => ({
        title,
        detail,
        occurredLabel,
      })),
    };
    expect(JSON.stringify(own)).not.toMatch(
      /Review|Notice|Auto-renews|annual|percent|primary|archive|refreshed|Invoice|Quote|Committed|overdue|awaiting|Opens|days/u,
    );
  });

  /**
   * The commercial fixtures carry facts beside English display strings kept
   * for older consumers. The dashboard read the strings, so a Spanish reader
   * saw "Open", "$184,800.00" and "Invoice for Northstar primary archive".
   */
  it("renders the commercial obligations from their facts", async () => {
    const dashboard = await dashboardIn("es");
    const commercial = dashboard.obligations.filter((item) =>
      ["Q-2026-0184-v3", "INV-2026-0781"].includes(item.id),
    );
    expect(commercial).toHaveLength(2);
    for (const item of commercial)
      expect(JSON.stringify([item.title, item.detail, item.state])).not.toMatch(
        /\bOpen\b|\$\d|Invoice for|annual|direct\b|US East/u,
      );
    expect(commercial[0]?.title).toMatch(/184\.800,00\sUS\$/u);
  });

  /**
   * Executed agreements keep their English titles on the agreements list; the
   * dashboard translated the same title, so one document had two names.
   */
  it("names the executed agreement by its English title", async () => {
    for (const language of languages)
      expect(
        (await dashboardIn(language)).term.agreementLabel,
        language,
      ).toMatch(/^\u2068?Cloud Service Agreement\b/u);
  });

  it("colours the renewal badge from facts, not from the words on it", async () => {
    for (const language of languages) {
      request.language = language;
      const projection = await loadCustomerDashboardProjection();
      const { container, unmount } = render(
        <CustomerDashboard
          projection={projection}
          greetingName="Mara"
          formatting={{ locale: "en-US", timeZone: "UTC" }}
        />,
      );
      const badge = [...container.querySelectorAll(".cw-badge")].find(
        (element) => element.textContent === projection.term.renewalState,
      );
      expect(badge?.className, language).toContain("cw-badge--success");
      unmount();
    }
  });

  it("names the partner and the route in the reader's language", async () => {
    request.language = "de";
    const partner = await loadPartnerDashboardProjection({
      accountId: demoAccountIds.reseller,
      accountName: "Ember Peak Systems",
    });
    expect(partner.agreement).toMatchObject({
      label: "Partnervereinbarung von Ember Peak Systems · v4.1",
      commercialRoute: "Wiederverkauf und zweistufiger Vertrieb",
      merchantBoundary:
        "Ember Peak Systems ist Merchant of Record gegenüber Endkunden im Vertriebsweg Wiederverkauf",
    });
    expect(partner.boundary).toEqual([
      { label: "Einkaufspreis", value: "Nur für Ember Peak Systems sichtbar" },
      { label: "Partnerpreis", value: "Festgelegt von Ember Peak Systems" },
      {
        label: "Merchant of Record",
        value: "Ember Peak Systems im Vertriebsweg Wiederverkauf",
      },
    ]);
  });
});
