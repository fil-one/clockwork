import "server-only";

import type { Route } from "next";
import type { RenewalState } from "@clockwork/ui";
import { NOT_RECORDED } from "@clockwork/workflows";
import { demoText, demoTextIn } from "@clockwork/testing/demo-localized-text";
import { findDemoProductionMarker } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";

import { getCommerceSession } from "@/src/auth/session";
import { formatMoney } from "@/src/features/shared/format";
import type { Locale, MessageId, Translator } from "@/src/i18n";
import {
  getFormattingLocale,
  getLocale,
  getTranslations,
} from "@/src/i18n/server";
import {
  collectionKinds,
  type CollectionKind,
} from "@/src/features/customer-partner/commercial/model";
import { projectionDisplay } from "@/src/features/customer-partner/commercial/record-presentation";
import type { CustomerDashboardProjection } from "@/src/features/customer-partner/customer/customer-dashboard";
import type { PartnerDashboardProjection } from "@/src/features/customer-partner/partner/partner-dashboard";

import {
  ago,
  dateRange,
  formatDemoFact,
  onDate,
  onDay,
  percent,
  terabytes,
  type DemoFact,
} from "./demo-message";
import { demoCloudServiceAgreementTitle } from "./demo-portal-records";
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
      // i18n-exempt: problem-details message for integrators; the page shows its own error state
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
      // i18n-exempt: problem-details message for integrators; the page shows its own error state
      `Dashboard field ${field} is not a same-origin route`,
    );
  const parsed = new URL(path, "https://experience.invalid");
  if (parsed.origin !== "https://experience.invalid")
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      // i18n-exempt: problem-details message for integrators; the page shows its own error state
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
      // i18n-exempt: problem-details message for integrators; the page shows its own error state
      `Dashboard field ${field} is invalid`,
    );
  return value as Record<string, unknown>[];
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExperienceProblem(
      502,
      "DASHBOARD_PROJECTION_INVALID",
      // i18n-exempt: problem-details message for integrators; the page shows its own error state
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

const DAY_IN_MS = 86_400_000;

/**
 * Who the dashboard is composed for: the interface language (demo text), the
 * formatting tag (dates, amounts, quantities) and the translator. Every phrase
 * the loader writes is a message rendered here, on the server, for this
 * reader; the dashboard components render the strings as given.
 */
interface DashboardReader {
  readonly locale: Locale;
  readonly formatting: string;
  readonly t: Translator;
}

async function dashboardReader(): Promise<DashboardReader> {
  const [locale, formatting, t] = await Promise.all([
    getLocale(),
    getFormattingLocale(),
    getTranslations(),
  ]);
  return { locale, formatting, t };
}

/**
 * Dates are formatted with the reader's formatting locale (the interface
 * language), passed in from the loader; there is no default.
 */
function formatMoment(time: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(time));
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDay(time: number | null, locale: string): string | null {
  return time === null
    ? null
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(time));
}

/** Formats one demo fact (an ISO date, a quantity, an age) for the reader. */
function fact(value: DemoFact, reader: DashboardReader): string {
  return formatDemoFact(value, reader.formatting);
}

/** A share of the term, 0–100, as the reader writes a percentage. */
function percentText(share: number, reader: DashboardReader): string {
  return fact(percent(share / 100), reader);
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
      "Dashboard record tone is invalid", // i18n-exempt: problem-details message for integrators; the page shows its own error state
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

function isCollectionKind(channel: string): channel is CollectionKind {
  return (collectionKinds as readonly string[]).includes(channel);
}

/**
 * The record's display strings for this reader.
 *
 * A commercial demo record carries `facts` beside English display strings
 * kept for older consumers (`projection-compat.ts`). The commercial surfaces
 * render the facts; this loader read the English strings, so the dashboard
 * showed "Open", "$184,800.00" and "400 TB · US East · annual · direct" to a
 * Spanish reader. A record without facts keeps its strings as written.
 */
function readerStrings(
  record: ProjectionRecord,
  reader: DashboardReader,
): Partial<
  Pick<
    DashboardRecord,
    "description" | "statusLabel" | "value" | "term" | "nextAction"
  >
> {
  if (!record.data.facts || !isCollectionKind(record.channel)) return {};
  const display = projectionDisplay(
    record.data,
    record.channel,
    record.sourceUpdatedAt,
    reader.t,
    reader.formatting,
  );
  return {
    description: display.description,
    statusLabel: display.statusLabel,
    ...(display.value ? { value: display.value } : {}),
    ...(display.term ? { term: display.term } : {}),
    ...(display.nextAction ? { nextAction: display.nextAction } : {}),
  };
}

function dashboardRecord(
  record: ProjectionRecord,
  /** Omitted where only non-commercial fields are read (commissions). */
  reader?: DashboardReader,
): DashboardRecord {
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
    ...(reader ? readerStrings(record, reader) : {}),
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
  reader: DashboardReader,
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
        entry.page.records.map((record) => dashboardRecord(record, reader)),
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
    type: "recordKind.invoice",
    actionLabel: "experience.data.dashboard.reviewInvoice",
    dueField: "dueAt",
  },
  {
    channel: "quotes",
    type: "recordKind.quote",
    actionLabel: "experience.data.dashboard.reviewQuote",
    dueField: "expiresAt",
  },
  {
    channel: "orders",
    type: "experience.data.dashboard.noticeAndRenewal",
    actionLabel: "experience.data.dashboard.reviewOrder",
    dueField: "noticeOn",
  },
] as const satisfies readonly {
  channel: CollectionKind;
  type: MessageId;
  actionLabel: MessageId;
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

function obligationTitle(record: DashboardRecord, t: Translator): string {
  const value = displayed(record.value);
  return value
    ? t("common.join.labels", { first: record.title, second: value })
    : record.title;
}

function customerObligations(
  records: ChannelRecords,
  t: Translator,
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
      type: t(item.source.type),
      title: obligationTitle(item.record, t),
      detail: item.record.description,
      actionLabel: t(item.source.actionLabel),
      href: route(
        recordRoute(item.source.channel, item.record.recordKey),
        "obligations.href",
      ),
      tone: item.record.tone,
      state: item.record.statusLabel,
      recordVersion: item.record.version,
    }));
}

/** Whether the notice window has opened, as of `now`. */
function noticeOpened(noticeAt: number | null, now: number): boolean {
  return noticeAt !== null && Math.round((noticeAt - now) / DAY_IN_MS) < 0;
}

function noticeLabel(
  noticeAt: number | null,
  noticeDays: number | null,
  now: number,
  reader: DashboardReader,
): string {
  const { t, formatting } = reader;
  if (noticeAt !== null) {
    const days = Math.round((noticeAt - now) / DAY_IN_MS);
    const date = formatDay(noticeAt, formatting) ?? "";
    if (days > 0)
      return t("experience.data.dashboard.noticeOpensIn", {
        date,
        count: days,
      });
    if (days === 0)
      return t("experience.data.dashboard.noticeOpensToday", { date });
    return t("experience.data.dashboard.noticeOpened", { date });
  }
  if (noticeDays !== null)
    return t("experience.data.dashboard.noticeDaysRequired", {
      count: noticeDays,
    });
  return t("experience.data.dashboard.noticeNone");
}

const renewalTypeLabels: Readonly<Record<string, MessageId>> = {
  auto_renew: "experience.data.dashboard.renewalAutoRenews",
  expires: "experience.data.dashboard.renewalExpires",
};

/**
 * The renewal badge's tone, decided from facts rather than from the words on
 * the badge: an opened notice window is the decision that matters, then the
 * renewal type. The component used to read these off the English labels.
 */
function renewalTone(
  opened: boolean,
  renewalType: string | null,
): "neutral" | "success" | "warning" {
  if (opened) return "warning";
  if (renewalType === "auto_renew") return "success";
  if (renewalType === "expires") return "warning";
  return "neutral";
}

/** A code with no message is shown as recorded rather than dropped. */
function renewalTypeText(renewalType: string | null, t: Translator): string {
  if (!renewalType) return t("common.notRecorded");
  const id = renewalTypeLabels[renewalType];
  return id ? t(id) : renewalType;
}

type CustomerTerm = CustomerDashboardProjection["term"] & {
  /**
   * The renewal badge's tone. `customer-dashboard.tsx` prefers it over reading
   * the (now translated) notice and renewal labels.
   */
  renewalTone: "neutral" | "success" | "warning";
};

function customerTerm(
  records: ChannelRecords,
  now: number,
  reader: DashboardReader,
): CustomerTerm {
  const { t, formatting } = reader;
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
  const noticeAt = order ? authoritativeTime(order, "noticeOn") : null;
  return {
    title:
      order?.title ??
      agreement?.title ??
      t("experience.data.dashboard.termFallbackTitle"),
    rangeLabel:
      order?.term ??
      agreement?.term ??
      t("experience.data.dashboard.termNoRange"),
    progressPercent: elapsed ?? 0,
    progressLabel:
      elapsed === null
        ? t("experience.data.dashboard.termProgressUnavailable")
        : t("experience.data.dashboard.termProgress", {
            percent: percentText(elapsed, reader),
          }),
    renewalState: renewalTypeText(renewalType, t),
    noticeLabel: noticeLabel(
      noticeAt,
      agreement ? authoritativeNumber(agreement, "noticeDays") : null,
      now,
      reader,
    ),
    renewalLabel: formatDay(end, formatting) ?? t("common.notRecorded"),
    agreementLabel:
      agreement?.title ?? t("experience.data.dashboard.termNoAgreement"),
    renewalTone: renewalTone(noticeOpened(noticeAt, now), renewalType),
  };
}

const activityNouns: Readonly<Partial<Record<ProjectionChannel, MessageId>>> = {
  agreements: "recordKind.agreement",
  billing: "recordKind.invoice",
  orders: "recordKind.order",
  portfolio: "recordKind.account",
  quotes: "recordKind.quote",
};

function recentActivity(
  records: ChannelRecords,
  reader: DashboardReader,
): CustomerDashboardProjection["activity"] {
  const { t, formatting } = reader;
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
        detail: t("common.join.labels", {
          first: t(
            activityNouns[record.channel] ??
              "experience.data.dashboard.activityRecord",
          ),
          second: record.statusLabel,
        }),
        occurredAt: record.updatedAt,
        occurredLabel:
          occurredAt === null
            ? record.updatedAt
            : formatMoment(occurredAt, formatting),
      };
    });
}

const customerChannels: readonly ProjectionChannel[] = [
  "billing",
  "quotes",
  "orders",
  "agreements",
];

/** Checked against the app's routes, as the fixture it replaced was. */
const servicesRoute: Route = "/services";

/**
 * The demo customer's account agreement, services, usage and activity: fixed
 * facts, rendered for the reader. Only the obligations come from records; the
 * rest has no projection channel in the demo.
 */
function demoCustomerDashboard(input: {
  loaded: LoadedChannels;
  accountName: string;
  reader: DashboardReader;
}): CustomerDashboardProjection & { term: CustomerTerm } {
  const { loaded, accountName, reader } = input;
  const { t } = reader;
  // Keep the fictional term dates, but age their display using the same
  // projection timestamp shown in Account facts.
  const demoTermStart = Date.parse("2026-01-01T00:00:00Z");
  const demoTermEnd = Date.parse("2027-01-01T00:00:00Z");
  const demoNoticeAt = Date.parse("2026-11-01T00:00:00Z");
  const progressPercent = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        ((loaded.now - demoTermStart) / (demoTermEnd - demoTermStart)) * 100,
      ),
    ),
  );
  const noticeDay = fact(onDay("2026-11-01"), reader);
  const madridReplica = demoText({
    en: "Madrid compliance replica",
    es: "Réplica de cumplimiento en Madrid",
    fr: "Réplique de conformité de Madrid",
    de: "Compliance-Replikat Madrid",
    ja: "マドリードのコンプライアンス用レプリカ",
    pt: "Réplica de conformidade em Madri",
    zh: "马德里合规副本",
    ar: "النسخة المتماثلة للامتثال في مدريد",
  });
  return {
    generatedAt: loaded.generatedAt,
    stale: loaded.stale,
    obligations: [
      ...customerObligations(loaded.records, t),
      {
        id: "renewal-0098",
        priority: 0,
        type: t("experience.data.dashboard.noticeAndRenewal"),
        title:
          loaded.now < demoNoticeAt
            ? t("experience.data.dashboard.noticeWindowOpens", {
                date: noticeDay,
              })
            : t("experience.data.dashboard.noticeWindowOpened", {
                date: noticeDay,
              }),
        detail: t("experience.data.dashboard.reviewServicePlan"),
        actionLabel: t("experience.data.dashboard.reviewServices"),
        href: servicesRoute,
        tone: "warning" as const,
        state: t("experience.data.dashboard.actionDue"),
        recordVersion: 4,
      },
    ].map((item, index) => ({ ...item, priority: index + 1 })),
    term: {
      title: t("experience.data.dashboard.termAnnual", {
        account: accountName,
      }),
      rangeLabel: fact(dateRange("2026-01-01", "2026-12-31"), reader),
      progressPercent,
      progressLabel: t("experience.data.dashboard.termProgress", {
        percent: percentText(progressPercent, reader),
      }),
      renewalState: t("experience.data.dashboard.renewalAutoRenews"),
      noticeLabel: noticeLabel(demoNoticeAt, null, loaded.now, reader),
      renewalLabel: fact(onDate("2027-01-01"), reader),
      agreementLabel: t("experience.data.dashboard.agreementWithVersion", {
        title: demoTextIn(demoCloudServiceAgreementTitle, reader.locale),
        version: "3.2",
      }),
      renewalTone: renewalTone(
        noticeOpened(demoNoticeAt, loaded.now),
        "auto_renew",
      ),
    },
    services: [
      {
        id: "service-primary",
        name: t("experience.data.dashboard.servicePrimaryArchive", {
          account: accountName,
        }),
        detail: t("experience.data.dashboard.serviceActiveFollowsTerm", {
          capacity: fact(terabytes(500), reader),
        }),
      },
      {
        id: "service-madrid",
        name: demoTextIn(madridReplica, reader.locale),
        detail: t("experience.data.dashboard.serviceProvisioningEnds", {
          capacity: fact(terabytes(120), reader),
          date: fact(onDate("2026-12-31"), reader),
        }),
      },
    ],
    capacity: {
      committed: fact(terabytes(620), reader),
      current: t("common.join.labels", {
        first: fact(terabytes(311), reader),
        second: fact(percent(0.502), reader),
      }),
      prior: t("experience.data.dashboard.capacityPriorChange", {
        capacity: fact(terabytes(292), reader),
        change: fact(terabytes(19), reader),
      }),
      freshnessLabel: t("experience.data.dashboard.capacityRefreshed", {
        relative: fact(ago(18, "minute"), reader),
      }),
    },
    activity: [
      {
        id: "activity-marketplace",
        title: t("experience.data.dashboard.activityMarketplaceSynced"),
        detail: t("experience.data.dashboard.activityAwsPrivateOffer"),
        occurredAt: "2026-07-31T15:42:00.000Z",
        occurredLabel: fact(ago(18, "minute"), reader),
      },
    ],
  };
}

/**
 * Composed at read time from the per-record channels rather than read from one
 * precomputed row: the rollup spans quotes, orders, invoices and agreements, so
 * an account-keyed row would go stale the moment any one of them changed.
 */
export async function loadCustomerDashboardProjection(
  accountName?: string,
): Promise<CustomerDashboardProjection> {
  const session = await getCommerceSession();
  const reader = await dashboardReader();
  if (explicitDashboardDemoEnabled()) {
    const loaded = await loadDashboardChannels(
      "customer",
      ["billing", "quotes"],
      session,
      reader,
    );
    return demoCustomerDashboard({
      loaded,
      // i18n-exempt: the demo account's name
      accountName: accountName ?? "Northstar",
      reader,
    });
  }
  const loaded = await loadDashboardChannels(
    "customer",
    customerChannels,
    session,
    reader,
  );
  return {
    generatedAt: loaded.generatedAt,
    stale: loaded.stale,
    obligations: customerObligations(loaded.records, reader.t),
    term: customerTerm(loaded.records, loaded.now, reader),
    services: channelRecords(loaded.records, "orders").map((record) => ({
      id: record.recordKey,
      name: record.title,
      detail: record.description,
    })),
    // Metered usage has no projection channel yet, so the capacity card falls
    // back to its empty state rather than deriving a number from commercial
    // records that do not measure use.
    capacity: null,
    activity: recentActivity(loaded.records, reader),
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
function termWindow(records: ChannelRecords, t: Translator): TermWindow | null {
  const order = governingOrder(records);
  const start = order ? authoritativeTime(order, "serviceStartsOn") : null;
  const end = order ? authoritativeTime(order, "serviceEndsOn") : null;
  if (order && start !== null && end !== null && end > start)
    return {
      label: t("experience.data.dashboard.partnerOrderServiceTerm", {
        order: order.title,
      }),
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
  reader: DashboardReader,
): PartnerDashboardProjection["work"] {
  const { t, formatting } = reader;
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
      task:
        item.record.nextAction ?? t("experience.data.dashboard.reviewQuote"),
      // No projection carries the evidence a partner task requires yet.
      evidence: t("common.notRecorded"),
      due:
        item.record.term ??
        formatDay(item.due, formatting) ??
        t("common.notRecorded"),
      href: route(
        `/partner/quotes/${encodeURIComponent(item.record.recordKey)}`,
        "work.href",
      ),
      // Both partner roles may open quote work; see partnerSurfaces.quotes.
      adminOnly: false,
      recordVersion: item.record.version,
    }));
}

const partnerTypeLabels: Readonly<Record<string, MessageId>> = {
  referral: "experience.data.dashboard.routeReferral",
  resale: "experience.data.dashboard.routeResale",
  msp: "experience.data.dashboard.routeMsp",
  embedded: "experience.data.dashboard.routeEmbedded",
};

function partnerAgreement(
  records: ChannelRecords,
  work: PartnerDashboardProjection["work"],
  now: number,
  reader: DashboardReader,
): PartnerDashboardProjection["agreement"] {
  const { t, formatting } = reader;
  const account = channelRecords(records, "portfolio")[0] ?? null;
  const agreement = channelRecords(records, "agreements")[0] ?? null;
  const window = termWindow(records, t);
  const partnerType = account
    ? authoritativeText(account, "partnerAgreementType")
    : null;
  const partnerTypeLabel = partnerType
    ? partnerTypeLabels[partnerType]
    : undefined;
  const nextDecision =
    work[0] === undefined
      ? t("experience.data.dashboard.partnerNoDecision")
      : t("common.join.labels", {
          first: work[0].account,
          second: work[0].task,
        });
  const shared = {
    nextDecision,
    commercialRoute: partnerTypeLabel
      ? t(partnerTypeLabel)
      : (partnerType ?? t("common.notRecorded")),
    // Merchant of record is not carried by any authoritative payload yet.
    merchantBoundary: t("common.notRecorded"),
  };

  // TermBar requires a valid window, so an account with no recorded term gets a
  // closed placeholder window whose labels say the term is absent.
  if (!window)
    return {
      ...shared,
      label: t("experience.data.dashboard.partnerNoTerm"),
      start: new Date(now - 2 * DAY_IN_MS).toISOString(),
      noticeStart: new Date(now - DAY_IN_MS).toISOString(),
      end: new Date(now - DAY_IN_MS).toISOString(),
      now: new Date(now).toISOString(),
      renewalState: "expired",
      authorityState: t("experience.data.dashboard.partnerNoTerm"),
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
        ? t("experience.data.dashboard.partnerTermEnded", {
            date: formatDay(window.end, formatting) ?? "",
          })
        : renewalState === "notice-open"
          ? t("experience.data.dashboard.partnerNoticeOpen")
          : window.notice === null
            ? t("experience.data.status.agreementInForce")
            : t("experience.data.dashboard.partnerInForceNoticeOpens", {
                date: formatDay(window.notice, formatting) ?? "",
              }),
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

/**
 * The demo partner desk: the agreement clock, the two work items and the
 * commercial boundary for the selected organization, rendered for the reader.
 */
function demoPartnerDashboard(input: {
  identity?: { accountId: string; accountName: string };
  reader: DashboardReader;
}): PartnerDashboardProjection {
  const { reader } = input;
  const { t, formatting } = reader;
  const name =
    input.identity?.accountName ??
    t("experience.data.dashboard.partnerYourOrganization");
  const referral = input.identity?.accountId === demoAccountIds.referral;
  const noticeReview = fact(onDay("2026-09-01"), reader);
  return {
    generatedAt: "2026-07-31T16:00:00.000Z",
    stale: false,
    agreement: {
      label: t("experience.data.dashboard.partnerAgreementLabel", {
        partner: name,
        version: "4.1",
      }),
      start: "2026-01-01T00:00:00.000Z",
      noticeStart: "2026-09-01T00:00:00.000Z",
      end: "2026-12-31T00:00:00.000Z",
      now: "2026-07-31T16:00:00.000Z",
      renewalState: "auto-renews",
      authorityState: t(
        "experience.data.dashboard.partnerInForceNoticeReviewDue",
        { date: noticeReview },
      ),
      nextDecision: t("experience.data.dashboard.partnerReviewAuthorityBy", {
        date: noticeReview,
      }),
      commercialRoute: referral
        ? t("experience.data.dashboard.routeReferral")
        : t("experience.data.dashboard.routeResaleAndTwoTier"),
      merchantBoundary: referral
        ? t("experience.data.dashboard.merchantFilOneReferred")
        : t("experience.data.dashboard.merchantPartnerResale", {
            partner: name,
          }),
    },
    work: [
      {
        id: "partner-renewal",
        account: "Halcyon Research Cooperative",
        task: t("experience.data.dashboard.workRenewalRouteEconomics"),
        evidence: t("experience.data.dashboard.workTransferFloorResaleTerm"),
        due: fact(onDay("2026-09-02"), reader),
        href: "/partner/renewals",
        adminOnly: true,
        recordVersion: 4,
      },
      {
        id: "partner-registration",
        account: "Atlas Field Imaging",
        task: t("experience.data.dashboard.workProtectDealRegistration"),
        evidence: t("experience.data.dashboard.workQualificationMissing"),
        due: t("experience.data.dashboard.workToday"),
        href: "/partner/registrations",
        adminOnly: false,
        recordVersion: 2,
      },
    ],
    commission: {
      id: "STM-2026-Q3",
      statement: t("experience.data.dashboard.commissionStatementQuarter", {
        quarter: 3,
      }),
      accruedAmount: t("experience.data.value.accrued", {
        amount: formatMoney("1842000", "USD", formatting),
      }),
      href: "/partner/commissions?q=STM-2026-Q3",
    },
    boundary: referral
      ? [
          {
            label: t("experience.data.dashboard.boundaryCustomerPricing"),
            value: t("experience.data.dashboard.boundarySetByFilOne"),
          },
          {
            label: t("experience.data.dashboard.boundaryMerchantOfRecord"),
            value: "Fil One",
          },
          {
            label: t("experience.data.dashboard.boundaryPartnerEarnings"),
            value: t("experience.data.dashboard.boundaryReferralCommission"),
          },
        ]
      : [
          {
            label: t("experience.data.dashboard.boundaryTransferPrice"),
            value: t("experience.data.dashboard.boundaryPrivateTo", {
              partner: name,
            }),
          },
          {
            label: t("experience.data.dashboard.boundaryPartnerPrice"),
            value: t("experience.data.dashboard.boundaryControlledBy", {
              partner: name,
            }),
          },
          {
            label: t("experience.data.dashboard.boundaryMerchantOfRecord"),
            value: t(
              "experience.data.dashboard.boundaryPartnerOnResaleRoutes",
              {
                partner: name,
              },
            ),
          },
        ],
  };
}

/** Partner account records route to `portfolio`, never to a `dashboard` row. */
export async function loadPartnerDashboardProjection(identity?: {
  accountId: string;
  accountName: string;
}): Promise<PartnerDashboardProjection> {
  const reader = await dashboardReader();
  if (explicitDashboardDemoEnabled())
    return demoPartnerDashboard({
      ...(identity ? { identity } : {}),
      reader,
    });
  const session = await getCommerceSession();
  const [loaded, commissions] = await Promise.all([
    loadDashboardChannels("partner", partnerChannels, session, reader),
    session.roles.includes("partner_admin")
      ? loadTopPortalRecords(
          "partner",
          "commissions",
          { limit: 1, orderBy: "updated_desc" },
          session,
        )
      : Promise.resolve(null),
  ]);
  const work = partnerWork(loaded.records, reader);
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
    agreement: partnerAgreement(loaded.records, work, loaded.now, reader),
    work,
    ...(commission ? { commission } : {}),
    boundary: account ? account.context : [],
  };
}
