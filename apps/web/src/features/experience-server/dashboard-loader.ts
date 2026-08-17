import "server-only";

import type { Route } from "next";
import type { RenewalState } from "@clockwork/ui";
import { NOT_RECORDED } from "@clockwork/workflows";
import { findDemoProductionMarker } from "@clockwork/testing/demo-state";

import { getCommerceSession } from "@/src/auth/session";
import type { CollectionKind } from "@/src/features/customer-partner/commercial/model";
import type { CustomerDashboardProjection } from "@/src/features/customer-partner/customer/customer-dashboard";
import type { PartnerDashboardProjection } from "@/src/features/customer-partner/partner/partner-dashboard";

import {
  ExperienceProblem,
  type ExperienceAudience,
  type ProjectionChannel,
  type ProjectionRecord,
} from "./model";
import {
  loadPortalRecords,
  loadTopPortalRecords,
  recordRoute,
} from "./portal-view-loader";

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value)
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      `Dashboard field ${field} is invalid`,
    );
  return value;
}

/** Absent fields fall back to an empty state; present-but-wrong fields fail. */
function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return string(value, field);
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
  commission: {
    id: "STM-2026-Q3",
    statement: "Q3 commission statement",
    accruedAmount: "$18,420 accrued",
    href: "/partner/commissions?q=STM-2026-Q3",
  },
  boundary: [
    { label: "Transfer price", value: "Private to Meridian" },
    { label: "Partner price", value: "Controlled by Meridian" },
    { label: "Merchant of record", value: "Meridian on resale routes" },
  ],
};

const DAY_IN_MS = 86_400_000;

const dayFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const momentFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDay(time: number | null): string | null {
  return time === null ? null : dayFormat.format(new Date(time));
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type DashboardTone = CustomerDashboardProjection["obligations"][number]["tone"];

const dashboardTones: readonly DashboardTone[] = [
  "neutral",
  "success",
  "warning",
  "danger",
];

function tone(value: unknown): DashboardTone {
  const parsed = string(value, "record.tone");
  const match = dashboardTones.find((candidate) => candidate === parsed);
  if (!match)
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      "Dashboard record tone is invalid",
    );
  return match;
}

/**
 * The per-record fields the dashboard rollups read.
 *
 * `authoritative` carries the aggregate payload the materializer projected, so
 * exact dates come from there rather than from a re-parsed display label.
 */
interface DashboardRecord {
  channel: ProjectionChannel;
  recordKey: string;
  version: number;
  updatedAt: string;
  title: string;
  description: string;
  status: string;
  statusLabel: string;
  tone: DashboardTone;
  nextAction: string | null;
  value: string | null;
  term: string | null;
  dateLabel: string | null;
  context: readonly { label: string; value: string }[];
  authoritative: Readonly<Record<string, unknown>>;
}

function dashboardRecord(record: ProjectionRecord): DashboardRecord {
  const payload = record.data;
  return {
    channel: record.channel,
    recordKey: record.recordKey,
    version: record.version,
    updatedAt: record.sourceUpdatedAt,
    title: string(payload.title, "record.title"),
    description: string(payload.description, "record.description"),
    status: string(payload.status, "record.status"),
    statusLabel: string(payload.statusLabel, "record.statusLabel"),
    tone: tone(payload.tone),
    nextAction: optionalString(payload.nextAction, "record.nextAction"),
    value: optionalString(payload.value, "record.value"),
    term: optionalString(payload.term, "record.term"),
    dateLabel: optionalString(payload.dateLabel, "record.dateLabel"),
    context:
      payload.context === undefined || payload.context === null
        ? []
        : array(payload.context, "record.context").map((entry) => ({
            label: string(entry.label, "record.context.label"),
            value: string(entry.value, "record.context.value"),
          })),
    authoritative:
      payload.authoritative === undefined || payload.authoritative === null
        ? {}
        : object(payload.authoritative, "record.authoritative"),
  };
}

function authoritativeText(
  record: DashboardRecord,
  field: string,
): string | null {
  const value = record.authoritative[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function authoritativeTime(
  record: DashboardRecord,
  field: string,
): number | null {
  return parseTime(authoritativeText(record, field));
}

function authoritativeNumber(
  record: DashboardRecord,
  field: string,
): number | null {
  const value = record.authoritative[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Drops the placeholder `describeAggregate` writes where an aggregate has no
 * amount, so an obligation title carries a figure or nothing at all.
 */
function displayed(value: string | null): string | null {
  return value && value !== NOT_RECORDED ? value : null;
}

type ChannelRecords = ReadonlyMap<
  ProjectionChannel,
  readonly DashboardRecord[]
>;

interface LoadedChannels {
  records: ChannelRecords;
  generatedAt: string;
  stale: boolean;
  now: number;
}

async function loadDashboardChannels(
  audience: ExperienceAudience,
  channels: readonly ProjectionChannel[],
  session: Awaited<ReturnType<typeof getCommerceSession>>,
): Promise<LoadedChannels> {
  const pages = await Promise.all(
    channels.map(async (channel) => ({
      channel,
      page: await loadPortalRecords(audience, channel, session),
    })),
  );
  const generatedAt =
    pages
      .map((entry) => entry.page.generatedAt)
      .sort()
      .at(-1) ?? new Date().toISOString();
  return {
    records: new Map(
      pages.map((entry) => [
        entry.channel,
        entry.page.records.map(dashboardRecord),
      ]),
    ),
    generatedAt,
    stale: pages.some((entry) => entry.page.stale),
    now: parseTime(generatedAt) ?? Date.now(),
  };
}

function channelRecords(
  records: ChannelRecords,
  channel: ProjectionChannel,
): readonly DashboardRecord[] {
  return records.get(channel) ?? [];
}

/** The order whose service window runs furthest forward governs the term. */
function governingOrder(records: ChannelRecords): DashboardRecord | null {
  return (
    [...channelRecords(records, "orders")].sort(
      (left, right) =>
        (authoritativeTime(right, "serviceEndsOn") ?? 0) -
        (authoritativeTime(left, "serviceEndsOn") ?? 0),
    )[0] ?? null
  );
}

const customerObligationSources = [
  {
    channel: "billing",
    type: "Invoice",
    actionLabel: "Review invoice",
    dueField: "dueAt",
  },
  {
    channel: "quotes",
    type: "Quote",
    actionLabel: "Review quote",
    dueField: "expiresAt",
  },
  {
    channel: "orders",
    type: "Notice and renewal",
    actionLabel: "Review order",
    dueField: "noticeOn",
  },
] as const satisfies readonly {
  channel: CollectionKind;
  type: string;
  actionLabel: string;
  dueField: string;
}[];

const settledInvoiceStatuses = ["paid", "complete", "canceled", "draft"];

/**
 * Quotes stay open until accepted or expired, invoices until settled, and an
 * order only asks for a decision once its notice date is close enough for the
 * materializer to mark it overdue.
 */
function isOutstanding(record: DashboardRecord): boolean {
  if (record.channel === "quotes") return record.status === "open";
  if (record.channel === "billing")
    return !settledInvoiceStatuses.includes(record.status);
  return record.tone === "danger";
}

const toneUrgency: Readonly<Record<DashboardTone, number>> = {
  danger: 0,
  warning: 1,
  neutral: 2,
  success: 3,
};

function obligationTitle(record: DashboardRecord): string {
  const value = displayed(record.value);
  return value ? `${record.title} · ${value}` : record.title;
}

function customerObligations(
  records: ChannelRecords,
): CustomerDashboardProjection["obligations"] {
  return customerObligationSources
    .flatMap((source) =>
      channelRecords(records, source.channel)
        .filter(isOutstanding)
        .map((record) => ({
          record,
          source,
          due:
            authoritativeTime(record, source.dueField) ??
            parseTime(record.dateLabel),
        })),
    )
    .sort((left, right) => {
      const urgency =
        toneUrgency[left.record.tone] - toneUrgency[right.record.tone];
      if (urgency !== 0) return urgency;
      if (left.due !== right.due) {
        if (left.due === null) return 1;
        if (right.due === null) return -1;
        return left.due - right.due;
      }
      return left.record.recordKey.localeCompare(right.record.recordKey);
    })
    .map((item, index) => ({
      id: item.record.recordKey,
      priority: index + 1,
      type: item.source.type,
      title: obligationTitle(item.record),
      detail: item.record.description,
      actionLabel: item.source.actionLabel,
      href: route(
        recordRoute(item.source.channel, item.record.recordKey),
        "obligations.href",
      ),
      tone: item.record.tone,
      state: item.record.statusLabel,
      recordVersion: item.record.version,
    }));
}

function noticeLabel(
  noticeAt: number | null,
  noticeDays: number | null,
  now: number,
): string {
  if (noticeAt !== null) {
    const days = Math.round((noticeAt - now) / DAY_IN_MS);
    const formatted = formatDay(noticeAt);
    if (days > 0) return `Opens ${formatted} · ${days} days`;
    if (days === 0) return `Opens ${formatted} · today`;
    return `Opened ${formatted}`;
  }
  if (noticeDays !== null) return `${noticeDays} days notice required`;
  return "No notice date recorded";
}

function customerTerm(
  records: ChannelRecords,
  now: number,
): CustomerDashboardProjection["term"] {
  const agreement = channelRecords(records, "agreements")[0] ?? null;
  const order = governingOrder(records);
  const start = order ? authoritativeTime(order, "serviceStartsOn") : null;
  const end = order ? authoritativeTime(order, "serviceEndsOn") : null;
  const elapsed =
    start !== null && end !== null && end > start
      ? Math.min(
          100,
          Math.max(0, Math.round(((now - start) / (end - start)) * 100)),
        )
      : null;
  const renewalType = agreement
    ? authoritativeText(agreement, "renewalType")
    : null;
  return {
    title: order?.title ?? agreement?.title ?? "Account term",
    rangeLabel:
      order?.term ?? agreement?.term ?? "No service term recorded yet",
    progressPercent: elapsed ?? 0,
    progressLabel:
      elapsed === null
        ? "Service term progress is not yet available"
        : `${elapsed} percent of the current commercial term elapsed`,
    renewalState: renewalType ? titleCase(renewalType) : NOT_RECORDED,
    noticeLabel: noticeLabel(
      order ? authoritativeTime(order, "noticeOn") : null,
      agreement ? authoritativeNumber(agreement, "noticeDays") : null,
      now,
    ),
    renewalLabel: formatDay(end) ?? NOT_RECORDED,
    agreementLabel: agreement?.title ?? "No agreement recorded",
  };
}

const activityNouns: Readonly<Partial<Record<ProjectionChannel, string>>> = {
  agreements: "Agreement",
  billing: "Invoice",
  orders: "Order",
  portfolio: "Account",
  quotes: "Quote",
};

function recentActivity(
  records: ChannelRecords,
): CustomerDashboardProjection["activity"] {
  return [...records.values()]
    .flat()
    .sort(
      (left, right) =>
        (parseTime(right.updatedAt) ?? 0) - (parseTime(left.updatedAt) ?? 0),
    )
    .slice(0, 5)
    .map((record) => {
      const occurredAt = parseTime(record.updatedAt);
      return {
        id: record.recordKey,
        title: record.title,
        detail: `${activityNouns[record.channel] ?? "Record"} · ${record.statusLabel}`,
        occurredAt: record.updatedAt,
        occurredLabel:
          occurredAt === null
            ? record.updatedAt
            : momentFormat.format(new Date(occurredAt)),
      };
    });
}

const customerChannels: readonly ProjectionChannel[] = [
  "billing",
  "quotes",
  "orders",
  "agreements",
];

/**
 * Composed at read time from the per-record channels rather than read from one
 * precomputed row: the rollup spans quotes, orders, invoices and agreements, so
 * an account-keyed row would go stale the moment any one of them changed.
 */
export async function loadCustomerDashboardProjection(): Promise<CustomerDashboardProjection> {
  if (explicitDashboardDemoEnabled()) return demoCustomer;
  const session = await getCommerceSession();
  const loaded = await loadDashboardChannels(
    "customer",
    customerChannels,
    session,
  );
  return {
    generatedAt: loaded.generatedAt,
    stale: loaded.stale,
    obligations: customerObligations(loaded.records),
    term: customerTerm(loaded.records, loaded.now),
    services: channelRecords(loaded.records, "orders").map((record) => ({
      id: record.recordKey,
      name: record.title,
      detail: record.description,
    })),
    // Metered usage has no projection channel yet, so the capacity card falls
    // back to its empty state rather than deriving a number from commercial
    // records that do not measure use.
    capacity: null,
    activity: recentActivity(loaded.records),
  };
}

const partnerChannels: readonly ProjectionChannel[] = [
  "portfolio",
  "quotes",
  "orders",
  "agreements",
];

interface TermWindow {
  label: string;
  start: number;
  end: number;
  notice: number | null;
}

function addMonths(time: number, months: number): number {
  const date = new Date(time);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

/**
 * The order service window is the only term a partner projection carries today;
 * the agreement window becomes available once agreement writes publish an
 * authoritative event.
 */
function termWindow(records: ChannelRecords): TermWindow | null {
  const order = governingOrder(records);
  const start = order ? authoritativeTime(order, "serviceStartsOn") : null;
  const end = order ? authoritativeTime(order, "serviceEndsOn") : null;
  if (order && start !== null && end !== null && end > start)
    return {
      label: `${order.title} service term`,
      start,
      end,
      notice: authoritativeTime(order, "noticeOn"),
    };

  const agreement = channelRecords(records, "agreements")[0];
  if (!agreement) return null;
  const effectiveOn = authoritativeTime(agreement, "effectiveOn");
  const termMonths = authoritativeNumber(agreement, "termMonths");
  if (effectiveOn === null || termMonths === null || termMonths <= 0)
    return null;
  const agreementEnd = addMonths(effectiveOn, termMonths);
  const noticeDays = authoritativeNumber(agreement, "noticeDays");
  return {
    label: agreement.title,
    start: effectiveOn,
    end: agreementEnd,
    notice: noticeDays === null ? null : agreementEnd - noticeDays * DAY_IN_MS,
  };
}

function partnerRenewalState(
  window: TermWindow,
  renewalType: string | null,
  now: number,
): RenewalState {
  if (now > window.end) return "expired";
  if (window.notice !== null && now >= window.notice) return "notice-open";
  if (renewalType === "auto_renew") return "auto-renews";
  if (renewalType === "expires") return "non-renewing";
  return "evergreen";
}

function endClientReference(record: DashboardRecord): string | null {
  const value = authoritativeText(record, "endClientAccountId");
  return value ? `EC-${value.slice(0, 8).toUpperCase()}` : null;
}

function partnerWork(
  records: ChannelRecords,
): PartnerDashboardProjection["work"] {
  return [...channelRecords(records, "quotes")]
    .filter((record) => record.status === "open" || record.tone === "danger")
    .map((record) => ({
      record,
      due: authoritativeTime(record, "expiresAt"),
    }))
    .sort((left, right) => {
      if (left.due !== right.due) {
        if (left.due === null) return 1;
        if (right.due === null) return -1;
        return left.due - right.due;
      }
      return left.record.recordKey.localeCompare(right.record.recordKey);
    })
    .map((item) => ({
      id: item.record.recordKey,
      account: endClientReference(item.record) ?? item.record.title,
      task: item.record.nextAction ?? "Review quote",
      // No projection carries the evidence a partner task requires yet.
      evidence: NOT_RECORDED,
      due: item.record.term ?? formatDay(item.due) ?? NOT_RECORDED,
      href: route(
        `/partner/quotes/${encodeURIComponent(item.record.recordKey)}`,
        "work.href",
      ),
      // Both partner roles may open quote work; see partnerSurfaces.quotes.
      adminOnly: false,
      recordVersion: item.record.version,
    }));
}

function partnerAgreement(
  records: ChannelRecords,
  work: PartnerDashboardProjection["work"],
  now: number,
): PartnerDashboardProjection["agreement"] {
  const account = channelRecords(records, "portfolio")[0] ?? null;
  const agreement = channelRecords(records, "agreements")[0] ?? null;
  const window = termWindow(records);
  const partnerType = account
    ? authoritativeText(account, "partnerAgreementType")
    : null;
  const nextDecision =
    work[0] === undefined
      ? "No partner decision is pending."
      : `${work[0].account} · ${work[0].task}`;
  const shared = {
    nextDecision,
    commercialRoute: partnerType ? titleCase(partnerType) : NOT_RECORDED,
    // Merchant of record is not carried by any authoritative payload yet.
    merchantBoundary: NOT_RECORDED,
  };

  // TermBar requires a valid window, so an account with no recorded term gets a
  // closed placeholder window whose labels say the term is absent.
  if (!window)
    return {
      ...shared,
      label: "No partner agreement term recorded",
      start: new Date(now - 2 * DAY_IN_MS).toISOString(),
      noticeStart: new Date(now - DAY_IN_MS).toISOString(),
      end: new Date(now - DAY_IN_MS).toISOString(),
      now: new Date(now).toISOString(),
      renewalState: "expired",
      authorityState: "No partner agreement term recorded",
    };

  const renewalState = partnerRenewalState(
    window,
    agreement ? authoritativeText(agreement, "renewalType") : null,
    now,
  );
  return {
    ...shared,
    label: window.label,
    start: new Date(window.start).toISOString(),
    noticeStart: new Date(window.notice ?? window.end).toISOString(),
    end: new Date(window.end).toISOString(),
    now: new Date(now).toISOString(),
    renewalState,
    authorityState:
      renewalState === "expired"
        ? `Term ended ${formatDay(window.end)}`
        : renewalState === "notice-open"
          ? "Notice window open"
          : window.notice === null
            ? "Active"
            : `Active · notice opens ${formatDay(window.notice)}`,
  };
}

function partnerCommission(
  record: ProjectionRecord | undefined,
): PartnerDashboardProjection["commission"] {
  if (!record) return undefined;
  const projected = dashboardRecord(record);
  const accruedAmount = displayed(projected.value);
  if (!accruedAmount) return undefined;
  return {
    id: projected.recordKey,
    statement: projected.title,
    accruedAmount,
    href: route(
      `/partner/commissions?q=${encodeURIComponent(projected.recordKey)}`,
      "commission.href",
    ),
  };
}

/** Partner account records route to `portfolio`, never to a `dashboard` row. */
export async function loadPartnerDashboardProjection(): Promise<PartnerDashboardProjection> {
  if (explicitDashboardDemoEnabled()) return demoPartner;
  const session = await getCommerceSession();
  const [loaded, commissions] = await Promise.all([
    loadDashboardChannels("partner", partnerChannels, session),
    session.roles.includes("partner_admin")
      ? loadTopPortalRecords(
          "partner",
          "commissions",
          { limit: 1, orderBy: "updated_desc" },
          session,
        )
      : Promise.resolve(null),
  ]);
  const work = partnerWork(loaded.records);
  const account = channelRecords(loaded.records, "portfolio")[0] ?? null;
  const commission = partnerCommission(commissions?.records[0]);
  return {
    generatedAt:
      [loaded.generatedAt, commissions?.generatedAt ?? loaded.generatedAt]
        .sort()
        .at(-1) ?? loaded.generatedAt,
    // A top-one read is intentionally a prefix. It does not make the panel
    // stale merely because older statements exist; only the selected record's
    // own projection freshness does.
    stale: loaded.stale || Boolean(commissions?.records[0]?.stale),
    agreement: partnerAgreement(loaded.records, work, loaded.now),
    work,
    ...(commission ? { commission } : {}),
    boundary: account ? account.context : [],
  };
}
