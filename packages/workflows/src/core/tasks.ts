import { task } from "@trigger.dev/sdk";

import { durableRetryPolicy } from "../policy";
import type { CoreFinanceWorkflowEngine } from "./engine";

let configuredEngine: CoreFinanceWorkflowEngine | undefined;

/** Called by the Trigger worker bootstrap after constructing real adapters. */
export function configureCoreFinanceWorkflowEngine(
  engine: CoreFinanceWorkflowEngine,
): void {
  if (configuredEngine && configuredEngine !== engine)
    throw new Error("Core finance workflow engine is already configured");
  configuredEngine = engine;
}

/** Test-only lifecycle helper; production bootstraps exactly once. */
export function resetCoreFinanceWorkflowEngineForTest(): void {
  configuredEngine = undefined;
}

function engine(): CoreFinanceWorkflowEngine {
  if (!configuredEngine)
    throw new Error(
      "Core finance workflow engine is not configured; initialize provider and repository adapters in the Trigger worker bootstrap",
    );
  return configuredEngine;
}

export const issueInvoiceTask = task({
  id: "core.billing.issue-invoice.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().issueInvoice(payload),
});

export const syncOverageTask = task({
  id: "core.billing.sync-overage.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().syncOverage(payload),
});

export const dunningTask = task({
  id: "core.collections.dunning.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().applyDunning(payload),
});

export const partnerCreditTask = task({
  id: "core.collections.partner-credit.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().evaluatePartnerCredit(payload),
});

export const settleCommissionsTask = task({
  id: "core.commissions.settle.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().settleCommissions(payload),
});

export const reconcileUsageTask = task({
  id: "core.reconciliation.usage.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().reconcileUsage(payload),
});

export const threeWayReconciliationTask = task({
  id: "core.reconciliation.three-way.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().reconcileThreeWay(payload),
});

export const exportReportTask = task({
  id: "core.reporting.export.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown) => engine().exportReport(payload),
});
