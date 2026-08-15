import "server-only";

import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";

import {
  billingAccountsByOrder,
  collectionCaseFromProjection,
  prioritizeCollectionCases,
  type CollectionCase,
} from "./collections-projection";
import type { SurfaceProvenance } from "./provenance";
import {
  prioritizeProvisioningWork,
  provisioningWorkFromProjection,
  type ProvisioningWork,
} from "./provisioning-projection";
import {
  orderReportExports,
  reportExportFromProjection,
  type ReportAccountOption,
  type ReportExportRecord,
} from "./reports-projection";
import {
  groupRenewalOrders,
  invoiceTotalsByOrder,
  renewalOrderFromProjection,
  type RenewalOrder,
  type RenewalWindow,
} from "./renewals-projection";

/**
 * Every internal lifecycle surface reads its own channel through the same
 * session-scoped loader the queue workspace uses. No fixture backfills any of
 * them: an empty channel renders an empty surface, which is the difference
 * between "there is no work" and "we did not look".
 */

export interface ProjectionWorkspace<T> {
  items: T;
  provenance: SurfaceProvenance;
}

function provenance(
  channel: string,
  page: {
    generatedAt: string;
    stale: boolean;
    pagesRead: number;
    recordCount: number;
  },
): SurfaceProvenance {
  return {
    kind: "projection",
    channel,
    generatedAt: page.generatedAt,
    stale: page.stale,
    pagesRead: page.pagesRead,
    recordCount: page.recordCount,
  };
}

export interface CollectionsWorkspace extends ProjectionWorkspace<
  readonly CollectionCase[]
> {
  /** Provenance of the orders read the billing accounts were joined from. */
  orderProvenance: SurfaceProvenance;
}

/**
 * Two session-scoped reads. The invoices are the work; the orders supply the
 * billing account a correction has to be bound to, which the invoice
 * projection does not carry.
 */
export async function loadCollectionsWorkspace(
  now: Date = new Date(),
): Promise<CollectionsWorkspace> {
  const [invoicePage, orderPage] = await Promise.all([
    loadPortalRecords("internal", "collections"),
    loadPortalRecords("internal", "orders"),
  ]);
  const billingAccounts = billingAccountsByOrder(orderPage.records);
  return {
    items: prioritizeCollectionCases(
      invoicePage.records.map((record) =>
        collectionCaseFromProjection(record, billingAccounts, now),
      ),
    ),
    provenance: provenance("collections", invoicePage),
    orderProvenance: provenance("orders", orderPage),
  };
}

export async function loadProvisioningWorkspace(): Promise<
  ProjectionWorkspace<readonly ProvisioningWork[]>
> {
  const page = await loadPortalRecords("internal", "provisioning");
  return {
    items: prioritizeProvisioningWork(
      page.records.map(provisioningWorkFromProjection),
    ),
    provenance: provenance("provisioning", page),
  };
}

export interface ReportsWorkspace extends ProjectionWorkspace<
  readonly ReportExportRecord[]
> {
  /**
   * Accounts an export may be scoped to, read from the internal `dashboard`
   * channel, which is the account aggregate. The label is the projection's own
   * reference and relationship description: the authoritative payload excludes
   * names, so there is no legal name to show and none is invented.
   */
  accounts: readonly ReportAccountOption[];
}

export async function loadReportsWorkspace(): Promise<ReportsWorkspace> {
  const [reportPage, accountPage] = await Promise.all([
    loadPortalRecords("internal", "reports"),
    loadPortalRecords("internal", "dashboard"),
  ]);
  const accounts = accountPage.records
    .map((record) => {
      const reference =
        typeof record.data.reference === "string"
          ? record.data.reference
          : record.recordKey;
      const description =
        typeof record.data.description === "string"
          ? ` · ${record.data.description}`
          : "";
      return { id: record.aggregateId, label: `${reference}${description}` };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  return {
    items: orderReportExports(
      reportPage.records.map(reportExportFromProjection),
    ),
    accounts,
    provenance: provenance("reports", reportPage),
  };
}

export interface RenewalsWorkspace extends ProjectionWorkspace<
  Readonly<Record<RenewalWindow, readonly RenewalOrder[]>>
> {
  /** Provenance of the second read the invoice totals came from. */
  invoiceProvenance: SurfaceProvenance;
  orders: readonly RenewalOrder[];
}

/**
 * Two reads, both session-scoped: the orders whose notice dates define the
 * renewal windows, and the invoices whose amounts are the only money any
 * projection can attribute to those orders.
 */
export async function loadRenewalsWorkspace(
  now: Date = new Date(),
): Promise<RenewalsWorkspace> {
  const [orderPage, invoicePage] = await Promise.all([
    loadPortalRecords("internal", "orders"),
    loadPortalRecords("internal", "collections"),
  ]);
  const totals = invoiceTotalsByOrder(invoicePage.records);
  const orders = orderPage.records.map((record) =>
    renewalOrderFromProjection(record, totals, now),
  );
  return {
    items: groupRenewalOrders(orders),
    orders,
    provenance: provenance("orders", orderPage),
    invoiceProvenance: provenance("collections", invoicePage),
  };
}
