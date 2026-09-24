import type { MessageId, Translator } from "@/src/i18n";
import "server-only";

import type { Route } from "next";

import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import type { ProjectionChannel } from "@/src/features/experience-server/model";
import {
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";

import {
  collectionCaseFromProjection,
  summarizeCollectionCases,
} from "../finance-lifecycle/collections-projection";
import {
  provisioningWorkFromProjection,
  summarizeProvisioningWork,
} from "../finance-lifecycle/provisioning-projection";
import {
  groupRenewalOrders,
  renewalOrderFromProjection,
} from "../finance-lifecycle/renewals-projection";
import {
  risk,
  totalInDominantCurrency,
} from "../finance-lifecycle/projection-fields";

/**
 * The operations home used to be six hand-written signals with hand-written
 * ages ("12 min ago") over hand-written values ("$182,400 overdue"). Every
 * number below is counted from a channel read in this request, and every
 * freshness is that read's own `generatedAt`.
 *
 * The retired signals also carried an owner per row. No internal projection
 * names a person, so there is no owner column any more rather than a column of
 * invented names.
 *
 * Every string is written here in the reader's language: `label`, `action`
 * and `detail` are messages, and `value` is a count or an amount formatted
 * with the reader's formatting locale.
 */
export interface OperationalSignal {
  label: string;
  value: string;
  detail: string;
  channel: ProjectionChannel;
  generatedAt: string;
  stale: boolean;
  href: Route;
  action: string;
  tone: "critical" | "warning" | "stable";
}

export interface OperationsHomeData {
  signals: readonly OperationalSignal[];
  /** Newest instant across every read, so the header states one honest time. */
  generatedAt: string;
  staleChannels: readonly ProjectionChannel[];
}

const countMessages = {
  cases: "operations.cases",
  records: "operations.records",
  orders: "operations.orders",
  exports: "operations.exports",
  priority: "operations.priority",
} as const satisfies Record<string, MessageId>;

const supportedCurrencies: ReadonlySet<string> = new Set<SupportedCurrency>([
  "USD",
  "EUR",
  "GBP",
]);

/**
 * An amount in minor units, formatted for the reader. The collections summary
 * formats its own totals in US English for the finance pages; the home page
 * sums the same cases itself so a Portuguese reader sees `US$ 1.200,00`, not
 * `$1,200.00`.
 */
function formatAmount(
  minor: bigint,
  currency: string | null,
  locale: string,
): string {
  if (currency && supportedCurrencies.has(currency))
    return formatMoney(minor, currency as SupportedCurrency, locale);
  const major = Number(minor) / 100;
  if (currency && /^[A-Z]{3}$/u.test(currency))
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(major);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/**
 * `t` and `locale` are required: a default translator is how this page used
 * to render English to every reader whose caller forgot to pass one.
 */
export async function loadOperationsHome(
  now: Date,
  t: Translator,
  locale: string,
): Promise<OperationsHomeData> {
  const number = (count: number) => new Intl.NumberFormat(locale).format(count);
  const countText = (count: number, key: keyof typeof countMessages) =>
    t(countMessages[key], { count });
  const [queues, provisioning, collections, orders, reports] =
    await Promise.all([
      loadPortalRecords("internal", "queues"),
      loadPortalRecords("internal", "provisioning"),
      loadPortalRecords("internal", "collections"),
      loadPortalRecords("internal", "orders"),
      loadPortalRecords("internal", "reports"),
    ]);

  const highRiskQueues = queues.records.filter(
    (record) => risk(record.data) === "high",
  ).length;
  const provisioningWork = provisioning.records.map(
    provisioningWorkFromProjection,
  );
  const provisioningSummary = summarizeProvisioningWork(provisioningWork);
  const collectionCases = collections.records.map((record) =>
    collectionCaseFromProjection(record, new Map(), now),
  );
  const collectionSummary = summarizeCollectionCases(collectionCases);
  const overdueTotal = totalInDominantCurrency(
    collectionCases
      .filter((entry) => entry.overdue)
      .map((entry) => ({ minor: entry.amountMinor, currency: entry.currency })),
  );
  const renewalWindows = groupRenewalOrders(
    orders.records.map((record) =>
      renewalOrderFromProjection(record, new Map(), now),
    ),
  );
  const noticeDue =
    renewalWindows["notice-passed"].length + renewalWindows["30"].length;

  const signals: OperationalSignal[] = [
    {
      label: t("operations.queueWork"),
      value: countText(queues.recordCount, "cases"),
      detail: countText(highRiskQueues, "priority"),
      channel: "queues",
      generatedAt: queues.generatedAt,
      stale: queues.stale,
      href: "/internal/queues",
      action: t("operations.home.signal.queues.action"),
      tone: highRiskQueues > 0 ? "critical" : "stable",
    },
    {
      label: t("operations.home.area.provisioning"),
      value: countText(provisioning.recordCount, "records"),
      detail: t("operations.home.signal.provisioning.detail", {
        operations: number(provisioningSummary.providerOperations),
        terminations: number(provisioningSummary.terminations),
      }),
      channel: "provisioning",
      generatedAt: provisioning.generatedAt,
      stale: provisioning.stale,
      href: "/internal/provisioning",
      action: t("operations.home.signal.provisioning.action"),
      tone: provisioningSummary.highRisk > 0 ? "critical" : "stable",
    },
    {
      label: t("operations.home.area.collections"),
      value:
        overdueTotal.counted > 0
          ? formatAmount(overdueTotal.total, overdueTotal.currency, locale)
          : t("operations.home.signal.collections.noAmount"),
      detail: t("operations.home.signal.collections.detail", {
        overdue: number(collectionSummary.overdueCount),
        open: number(collectionSummary.openCount),
      }),
      channel: "collections",
      generatedAt: collections.generatedAt,
      stale: collections.stale,
      href: "/internal/collections",
      action: t("operations.home.signal.collections.action"),
      tone: collectionSummary.overdueCount > 0 ? "warning" : "stable",
    },
    {
      label: t("operations.home.signal.renewals"),
      value: countText(noticeDue, "orders"),
      detail: t("operations.home.signal.renewals.detail"),
      channel: "orders",
      generatedAt: orders.generatedAt,
      stale: orders.stale,
      href: "/internal/renewals",
      action: t("operations.home.signal.renewals.action"),
      tone: renewalWindows["notice-passed"].length > 0 ? "warning" : "stable",
    },
    {
      label: t("operations.home.signal.reports"),
      value: countText(reports.recordCount, "exports"),
      detail: t("operations.home.signal.reports.detail"),
      channel: "reports",
      generatedAt: reports.generatedAt,
      stale: reports.stale,
      href: "/internal/reports",
      action: t("operations.home.signal.reports.action"),
      tone: "stable",
    },
  ];

  const instants = signals.map((signal) => Date.parse(signal.generatedAt));
  const newest = Math.max(...instants.filter(Number.isFinite));
  return {
    signals,
    generatedAt: Number.isFinite(newest)
      ? new Date(newest).toISOString()
      : now.toISOString(),
    staleChannels: signals
      .filter((signal) => signal.stale)
      .map((signal) => signal.channel),
  };
}
