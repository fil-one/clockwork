import type {
  Page,
  PageScreenshotOptions,
  ViewportSize,
} from "@playwright/test";

import { demoPersonaHeaders, type DemoPersonaKey } from "../personas/catalog";
import { DEMO_NOW, DEMO_ORIGIN } from "../demo/seed";

export type ExperienceState =
  | "empty"
  | "loading"
  | "offline"
  | "optimistic"
  | "partial"
  | "permission_denied"
  | "ready"
  | "recoverable_error"
  | "stale_version"
  | "success"
  | "unrecoverable_error"
  | "validation_error";

export const experienceStateCatalog = [
  "loading",
  "empty",
  "partial",
  "optimistic",
  "success",
  "validation_error",
  "permission_denied",
  "stale_version",
  "offline",
  "recoverable_error",
  "unrecoverable_error",
  "ready",
] as const satisfies readonly ExperienceState[];

export const visualViewports = {
  mobile320: { width: 320, height: 720 },
  mobile390: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 1000 },
} as const satisfies Record<string, ViewportSize>;

export interface VisualScenario {
  readonly id: string;
  readonly route: `/${string}`;
  readonly persona: DemoPersonaKey;
  readonly state: ExperienceState;
  readonly viewport: keyof typeof visualViewports;
  readonly colorScheme: "dark" | "light";
}

export const visualScenarios = [
  {
    id: "direct-dashboard-ready",
    route: "/client/dashboard",
    persona: "directBuyer",
    state: "ready",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "direct-renewal-loading-mobile",
    route: "/client/renewals/renewal-meridian-2026",
    persona: "directBuyer",
    state: "loading",
    viewport: "mobile320",
    colorScheme: "light",
  },
  {
    id: "billing-recovery-mobile",
    route: "/client/billing/invoice-meridian-overdue",
    persona: "billingUser",
    state: "recoverable_error",
    viewport: "mobile390",
    colorScheme: "light",
  },
  {
    id: "end-client-partial-service",
    route: "/client/services/service-referral-end-client",
    persona: "endClient",
    state: "partial",
    viewport: "tablet",
    colorScheme: "light",
  },
  {
    id: "partner-agreement-clock",
    route: "/partner",
    persona: "reseller",
    state: "ready",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "referral-deal-stale",
    route: "/partner/deals/deal-northstar-lumen",
    persona: "referralPartner",
    state: "stale_version",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "resale-quote-validation",
    route: "/partner/quotes/quote-resale-customer-v4",
    persona: "reseller",
    state: "validation_error",
    viewport: "tablet",
    colorScheme: "light",
  },
  {
    id: "distributor-portfolio-offline",
    route: "/partner/portfolio",
    persona: "distributor",
    state: "offline",
    viewport: "mobile390",
    colorScheme: "light",
  },
  {
    id: "legal-stale-approval",
    route: "/internal/approvals/legal/queue-legal-meridian",
    persona: "legalApprover",
    state: "stale_version",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "finance-permission-denied",
    route: "/internal/provisioning/queue-provision-cobalt",
    persona: "financeApprover",
    state: "permission_denied",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "operator-optimistic-retry",
    route: "/internal/provisioning/queue-provision-cobalt",
    persona: "internalOperator",
    state: "optimistic",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "quote-success",
    route: "/client/quotes/quote-direct-renewal-v2",
    persona: "directBuyer",
    state: "success",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "portfolio-empty",
    route: "/partner/portfolio",
    persona: "referralPartner",
    state: "empty",
    viewport: "desktop",
    colorScheme: "light",
  },
  {
    id: "internal-report-unrecoverable",
    route: "/internal/reports/reconciliation",
    persona: "internalOperator",
    state: "unrecoverable_error",
    viewport: "desktop",
    colorScheme: "light",
  },
] as const satisfies readonly VisualScenario[];

export function visualScenarioUrl(
  scenario: VisualScenario,
  origin: string = DEMO_ORIGIN,
): string {
  const url = new URL(scenario.route, origin);
  url.searchParams.set("demo", "true");
  url.searchParams.set("experienceState", scenario.state);
  return url.toString();
}

export function visualSnapshotName(scenario: VisualScenario): string {
  return `${scenario.id}-${scenario.viewport}-${scenario.colorScheme}.png`;
}

export async function installVisualDeterminism(
  page: Page,
  scenario: VisualScenario,
): Promise<void> {
  await page
    .context()
    .setExtraHTTPHeaders(demoPersonaHeaders(scenario.persona));
  await page.setViewportSize(visualViewports[scenario.viewport]);
  await page.emulateMedia({
    colorScheme: scenario.colorScheme,
    reducedMotion: "reduce",
  });
  await page.clock.install({ time: new Date(DEMO_NOW) });
  await page.addInitScript(
    ({ state }) => {
      Object.defineProperty(window, "__CLOCKWORK_VISUAL_STATE__", {
        configurable: false,
        enumerable: false,
        value: state,
        writable: false,
      });
    },
    { state: scenario.state },
  );
}

export async function settleVisualPage(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });
  await page.evaluate(async () => document.fonts.ready);
}

export function dynamicVisualMasks(page: Page) {
  return [
    page.locator("[data-visual-dynamic]"),
    page.locator("[data-provider-external-reference]"),
  ];
}

export function visualScreenshotOptions(page: Page): PageScreenshotOptions {
  return {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    mask: dynamicVisualMasks(page),
    scale: "css",
  };
}
