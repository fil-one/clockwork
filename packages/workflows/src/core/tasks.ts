import { task } from "@trigger.dev/sdk";

import { durableRetryPolicy } from "../policy";
import type { CoreFinanceWorkflowEngine } from "./engine";
import { executeConfiguredCoreWorkflow } from "./task-runtime";

function execute(
  taskId: string,
  payload: unknown,
  context: { run: { id: string }; attempt: { number: number } },
  operation: (engine: CoreFinanceWorkflowEngine) => Promise<unknown>,
) {
  return executeConfiguredCoreWorkflow({
    taskId,
    triggerRunId: context.run.id,
    attempt: context.attempt.number,
    operation: (engine) => operation(engine),
  });
}

export const issueInvoiceTask = task({
  id: "core.billing.issue-invoice.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.billing.issue-invoice.v1", payload, ctx, (engine) =>
      engine.issueInvoice(payload),
    ),
});

export const syncOverageTask = task({
  id: "core.billing.sync-overage.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.billing.sync-overage.v1", payload, ctx, (engine) =>
      engine.syncOverage(payload),
    ),
});

export const dunningTask = task({
  id: "core.collections.dunning.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.collections.dunning.v1", payload, ctx, (engine) =>
      engine.applyDunning(payload),
    ),
});

export const certificateExpiryTask = task({
  id: "core.procurement.certificate-expiry.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.procurement.certificate-expiry.v1", payload, ctx, (engine) =>
      engine.assessCertificateExpiry(payload),
    ),
});

export const partnerCreditTask = task({
  id: "core.collections.partner-credit.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.collections.partner-credit.v1", payload, ctx, (engine) =>
      engine.evaluatePartnerCredit(payload),
    ),
});

export const settleCommissionsTask = task({
  id: "core.commissions.settle.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.commissions.settle.v1", payload, ctx, (engine) =>
      engine.settleCommissions(payload),
    ),
});

export const reconcileUsageTask = task({
  id: "core.reconciliation.usage.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.reconciliation.usage.v1", payload, ctx, (engine) =>
      engine.reconcileUsage(payload),
    ),
});

export const threeWayReconciliationTask = task({
  id: "core.reconciliation.three-way.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.reconciliation.three-way.v1", payload, ctx, (engine) =>
      engine.reconcileThreeWay(payload),
    ),
});

export const exportReportTask = task({
  id: "core.reporting.export.v1",
  retry: durableRetryPolicy,
  run: (payload: unknown, { ctx }) =>
    execute("core.reporting.export.v1", payload, ctx, (engine) =>
      engine.exportReport(payload),
    ),
});
