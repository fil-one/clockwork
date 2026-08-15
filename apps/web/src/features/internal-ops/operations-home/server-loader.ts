import "server-only";

import type { Route } from "next";

import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import type { ProjectionChannel } from "@/src/features/experience-server/model";

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
import { risk } from "../finance-lifecycle/projection-fields";

/**
 * The operations home used to be six hand-written signals with hand-written
 * ages ("12 min ago") over hand-written values ("$182,400 overdue"). Every
 * number below is counted from a channel read in this request, and every
 * freshness is that read's own `generatedAt`.
 *
 * The retired signals also carried an owner per row. No internal projection
 * names a person, so there is no owner column any more rather than a column of
 * invented names.
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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export async function loadOperationsHome(
  now: Date = new Date(),
): Promise<OperationsHomeData> {
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
  const collectionSummary = summarizeCollectionCases(
    collections.records.map((record) =>
      collectionCaseFromProjection(record, new Map(), now),
    ),
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
      label: "Queue work",
      value: plural(queues.recordCount, "case", "cases"),
      detail: `${plural(highRiskQueues, "case is", "cases are")} marked high risk by the projection.`,
      channel: "queues",
      generatedAt: queues.generatedAt,
      stale: queues.stale,
      href: "/internal/queues",
      action: "Open the queue",
      tone: highRiskQueues > 0 ? "critical" : "stable",
    },
    {
      label: "Provisioning",
      value: plural(provisioning.recordCount, "record", "records"),
      detail: `${plural(provisioningSummary.providerOperations, "provider operation", "provider operations")} and ${plural(provisioningSummary.terminations, "termination", "terminations")}.`,
      channel: "provisioning",
      generatedAt: provisioning.generatedAt,
      stale: provisioning.stale,
      href: "/internal/provisioning",
      action: "Open provisioning",
      tone: provisioningSummary.highRisk > 0 ? "critical" : "stable",
    },
    {
      label: "Collections",
      value: collectionSummary.overdueTotal ?? "No amount recorded",
      detail: `${plural(collectionSummary.overdueCount, "invoice is", "invoices are")} past due, out of ${plural(collectionSummary.openCount, "open invoice", "open invoices")}.`,
      channel: "collections",
      generatedAt: collections.generatedAt,
      stale: collections.stale,
      href: "/internal/collections",
      action: "Open collections",
      tone: collectionSummary.overdueCount > 0 ? "warning" : "stable",
    },
    {
      label: "Renewal notice",
      value: plural(noticeDue, "order", "orders"),
      detail:
        "Orders whose contractual notice date has passed or falls inside 30 days. No exposure estimate is available from any projection.",
      channel: "orders",
      generatedAt: orders.generatedAt,
      stale: orders.stale,
      href: "/internal/renewals",
      action: "Open renewals",
      tone: renewalWindows["notice-passed"].length > 0 ? "warning" : "stable",
    },
    {
      label: "Report exports",
      value: plural(reports.recordCount, "export", "exports"),
      detail: "Exports recorded against your operator session.",
      channel: "reports",
      generatedAt: reports.generatedAt,
      stale: reports.stale,
      href: "/internal/reports",
      action: "Open reports",
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
