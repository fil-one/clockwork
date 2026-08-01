import "server-only";

import type { Route } from "next";
import type { RenewalState } from "@clockwork/ui";
import { findDemoProductionMarker } from "@clockwork/testing/demo-state";

import { getCommerceSession } from "@/src/auth/session";
import type { CustomerDashboardProjection } from "@/src/features/customer-partner/customer/customer-dashboard";
import type { PartnerDashboardProjection } from "@/src/features/customer-partner/partner/partner-dashboard";

import { ExperienceProblem, type ProjectionRecord } from "./model";
import {
  configuredProjectionSource,
  projectionInput,
} from "./projection-source";

function data(record: ProjectionRecord | undefined): Record<string, unknown> {
  if (!record)
    throw new ExperienceProblem(
      503,
      "DASHBOARD_PROJECTION_MISSING",
      "Dashboard projection is unavailable",
    );
  return { ...record.data };
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value)
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      `Dashboard field ${field} is invalid`,
    );
  return value;
}

function renewalState(value: unknown): RenewalState {
  const parsed = string(value, "agreement.renewalState");
  switch (parsed) {
    case "auto-renews":
    case "evergreen":
    case "notice-open":
    case "non-renewing":
    case "renewed":
    case "expired":
      return parsed;
    default:
      throw new ExperienceProblem(
        502,
        "DASHBOARD_PROJECTION_INVALID",
        "Dashboard renewal state is invalid",
      );
  }
}

function route(value: unknown, field: string): Route {
  const path = string(value, field);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      `Dashboard field ${field} is not a same-origin route`,
    );
  const parsed = new URL(path, "https://experience.invalid");
  if (parsed.origin !== "https://experience.invalid")
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      `Dashboard field ${field} is not a same-origin route`,
    );
  return `${parsed.pathname}${parsed.search}${parsed.hash}` as Route;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      `Dashboard field ${field} is invalid`,
    );
  return value;
}

function array(value: unknown, field: string): Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      `Dashboard field ${field} is invalid`,
    );
  return value as Record<string, unknown>[];
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      `Dashboard field ${field} is invalid`,
    );
  return value as Record<string, unknown>;
}

export function explicitDashboardDemoEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    environment.CLOCKWORK_EXPERIENCE_ADAPTER?.trim() === "demo" &&
    !findDemoProductionMarker(environment) &&
    environment.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV?.trim().toLowerCase() !==
      "production"
  );
}

const demoCustomer: CustomerDashboardProjection = {
  generatedAt: "2026-07-31T15:42:00.000Z",
  stale: false,
  obligations: [
    {
      id: "invoice-0781",
      priority: 1,
      type: "Invoice",
      title: "$15,400 due Aug 15",
      detail: "Invoice INV-2026-0781 is awaiting payment.",
      actionLabel: "Review invoice",
      href: "/billing",
      tone: "warning",
      state: "Action due",
      recordVersion: 3,
    },
    {
      id: "renewal-0098",
      priority: 2,
      type: "Notice and renewal",
      title: "Notice window opens Nov 1",
      detail: "Review the service plan before the account notice date.",
      actionLabel: "Review services",
      href: "/services",
      tone: "warning",
      state: "Action due",
      recordVersion: 4,
    },
    {
      id: "quote-0184",
      priority: 3,
      type: "Quote",
      title: "Enterprise quote expires Aug 3",
      detail: "Three days remain to accept or let the open quote expire.",
      actionLabel: "Review quote",
      href: "/quotes/Q-2026-0184-v3" as Route,
      tone: "warning",
      state: "Action due",
      recordVersion: 3,
    },
  ],
  term: {
    title: "Northstar annual term",
    rangeLabel: "Jan 1 - Dec 31, 2026",
    progressPercent: 58,
    progressLabel: "58 percent of the current commercial term elapsed",
    renewalState: "Auto-renews",
    noticeLabel: "Opens Nov 1 - 93 days",
    renewalLabel: "Jan 1, 2027",
    agreementLabel: "Cloud Service Agreement v3.2",
  },
  services: [
    {
      id: "service-primary",
      name: "Northstar primary archive",
      detail: "500 TB - active - follows account term",
    },
    {
      id: "service-madrid",
      name: "Madrid compliance replica",
      detail: "120 TB - provisioning - ends Dec 31, 2026",
    },
  ],
  capacity: {
    committed: "620 TB",
    current: "311 TB - 50.2%",
    prior: "292 TB - up 19 TB",
    freshnessLabel: "Usage projection refreshed 18 minutes ago",
  },
  activity: [
    {
      id: "activity-marketplace",
      title: "Marketplace fulfillment synchronized",
      detail: "AWS private offer - provider-reported",
      occurredAt: "2026-07-31T15:42:00.000Z",
      occurredLabel: "18 minutes ago",
    },
  ],
};

const demoPartner: PartnerDashboardProjection = {
  generatedAt: "2026-07-31T16:00:00.000Z",
  stale: false,
  agreement: {
    label: "Meridian Channel Partner Agreement - v4.1",
    start: "2026-01-01T00:00:00.000Z",
    noticeStart: "2026-09-01T00:00:00.000Z",
    end: "2026-12-31T00:00:00.000Z",
    now: "2026-07-31T16:00:00.000Z",
    renewalState: "auto-renews",
    authorityState: "Active - notice review due Sep 1",
    nextDecision: "Review authority and notice position by Sep 1",
    commercialRoute: "Resale and two-tier distributor",
    merchantBoundary: "Meridian is merchant of record to end clients",
  },
  work: [
    {
      id: "partner-renewal",
      account: "Halcyon Research Cooperative",
      task: "Renewal route and economics",
      evidence: "Transfer floor and resale term",
      due: "Sep 2",
      href: "/partner/renewals",
      adminOnly: true,
      recordVersion: 4,
    },
    {
      id: "partner-registration",
      account: "Atlas Field Imaging",
      task: "Protect deal registration",
      evidence: "Commercial qualification missing",
      due: "Today",
      href: "/partner/registrations",
      adminOnly: false,
      recordVersion: 2,
    },
  ],
  boundary: [
    { label: "Transfer price", value: "Private to Meridian" },
    { label: "Partner price", value: "Controlled by Meridian" },
    { label: "Merchant of record", value: "Meridian on resale routes" },
  ],
};

export async function loadCustomerDashboardProjection(): Promise<CustomerDashboardProjection> {
  if (explicitDashboardDemoEnabled()) return demoCustomer;
  const session = await getCommerceSession();
  const page = await configuredProjectionSource().list(
    projectionInput({
      session,
      audience: "customer",
      channel: "dashboard",
      requestedAccountId: session.accountIds[0] ?? null,
      limit: 1,
    }),
  );
  const value = data(page.items[0]);
  const term = object(value.term, "term");
  const capacity = object(value.capacity, "capacity");
  return {
    generatedAt: page.generatedAt,
    stale: page.items[0]?.stale ?? true,
    obligations: array(value.obligations, "obligations").map((item) => ({
      id: string(item.id, "obligations.id"),
      priority: number(item.priority, "obligations.priority"),
      type: string(item.type, "obligations.type"),
      title: string(item.title, "obligations.title"),
      detail: string(item.detail, "obligations.detail"),
      actionLabel: string(item.actionLabel, "obligations.actionLabel"),
      href: route(item.href, "obligations.href"),
      tone: string(
        item.tone,
        "obligations.tone",
      ) as CustomerDashboardProjection["obligations"][number]["tone"],
      state: string(item.state, "obligations.state"),
      recordVersion: number(item.recordVersion, "obligations.recordVersion"),
    })),
    term: {
      title: string(term.title, "term.title"),
      rangeLabel: string(term.rangeLabel, "term.rangeLabel"),
      progressPercent: number(term.progressPercent, "term.progressPercent"),
      progressLabel: string(term.progressLabel, "term.progressLabel"),
      renewalState: string(term.renewalState, "term.renewalState"),
      noticeLabel: string(term.noticeLabel, "term.noticeLabel"),
      renewalLabel: string(term.renewalLabel, "term.renewalLabel"),
      agreementLabel: string(term.agreementLabel, "term.agreementLabel"),
    },
    services: array(value.services, "services").map((item) => ({
      id: string(item.id, "services.id"),
      name: string(item.name, "services.name"),
      detail: string(item.detail, "services.detail"),
    })),
    capacity: {
      committed: string(capacity.committed, "capacity.committed"),
      current: string(capacity.current, "capacity.current"),
      prior: string(capacity.prior, "capacity.prior"),
      freshnessLabel: string(
        capacity.freshnessLabel,
        "capacity.freshnessLabel",
      ),
    },
    activity: array(value.activity, "activity").map((item) => ({
      id: string(item.id, "activity.id"),
      title: string(item.title, "activity.title"),
      detail: string(item.detail, "activity.detail"),
      occurredAt: string(item.occurredAt, "activity.occurredAt"),
      occurredLabel: string(item.occurredLabel, "activity.occurredLabel"),
    })),
  };
}

export async function loadPartnerDashboardProjection(): Promise<PartnerDashboardProjection> {
  if (explicitDashboardDemoEnabled()) return demoPartner;
  const session = await getCommerceSession();
  const page = await configuredProjectionSource().list(
    projectionInput({
      session,
      audience: "partner",
      channel: "dashboard",
      requestedAccountId: session.accountIds[0] ?? null,
      limit: 1,
    }),
  );
  const value = data(page.items[0]);
  const agreement = object(value.agreement, "agreement");
  return {
    generatedAt: page.generatedAt,
    stale: page.items[0]?.stale ?? true,
    agreement: {
      label: string(agreement.label, "agreement.label"),
      start: string(agreement.start, "agreement.start"),
      noticeStart: string(agreement.noticeStart, "agreement.noticeStart"),
      end: string(agreement.end, "agreement.end"),
      now: string(agreement.now, "agreement.now"),
      renewalState: renewalState(agreement.renewalState),
      authorityState: string(
        agreement.authorityState,
        "agreement.authorityState",
      ),
      nextDecision: string(agreement.nextDecision, "agreement.nextDecision"),
      commercialRoute: string(
        agreement.commercialRoute,
        "agreement.commercialRoute",
      ),
      merchantBoundary: string(
        agreement.merchantBoundary,
        "agreement.merchantBoundary",
      ),
    },
    work: array(value.work, "work").map((item) => ({
      id: string(item.id, "work.id"),
      account: string(item.account, "work.account"),
      task: string(item.task, "work.task"),
      evidence: string(item.evidence, "work.evidence"),
      due: string(item.due, "work.due"),
      href: route(item.href, "work.href"),
      adminOnly: item.adminOnly === true,
      recordVersion: number(item.recordVersion, "work.recordVersion"),
    })),
    boundary: array(value.boundary, "boundary").map((item) => ({
      label: string(item.label, "boundary.label"),
      value: string(item.value, "boundary.value"),
    })),
  };
}
