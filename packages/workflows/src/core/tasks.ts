import type { TaskContext } from "../tasks/definition";
import { defineTask } from "../tasks/definition";
import type { CoreFinanceWorkflowEngine } from "./engine";
import { executeConfiguredCoreWorkflow } from "./task-runtime";

function execute(
  taskId: string,
  context: TaskContext,
  operation: (engine: CoreFinanceWorkflowEngine) => Promise<unknown>,
) {
  return executeConfiguredCoreWorkflow({
    taskId,
    triggerRunId: context.runId,
    attempt: context.attempt,
    operation: (engine) => operation(engine),
  });
}

export const issueInvoiceTask = defineTask({
  id: "core.billing.issue-invoice.v1",
  run: (payload: unknown, ctx) =>
    execute("core.billing.issue-invoice.v1", ctx, (engine) =>
      engine.issueInvoice(payload),
    ),
});

export const syncOverageTask = defineTask({
  id: "core.billing.sync-overage.v1",
  run: (payload: unknown, ctx) =>
    execute("core.billing.sync-overage.v1", ctx, (engine) =>
      engine.syncOverage(payload),
    ),
});

export const dunningTask = defineTask({
  id: "core.collections.dunning.v1",
  run: (payload: unknown, ctx) =>
    execute("core.collections.dunning.v1", ctx, (engine) =>
      engine.applyDunning(payload),
    ),
});

export const certificateExpiryTask = defineTask({
  id: "core.procurement.certificate-expiry.v1",
  run: (payload: unknown, ctx) =>
    execute("core.procurement.certificate-expiry.v1", ctx, (engine) =>
      engine.assessCertificateExpiry(payload),
    ),
});

export const partnerCreditTask = defineTask({
  id: "core.collections.partner-credit.v1",
  run: (payload: unknown, ctx) =>
    execute("core.collections.partner-credit.v1", ctx, (engine) =>
      engine.evaluatePartnerCredit(payload),
    ),
});

export const settleCommissionsTask = defineTask({
  id: "core.commissions.settle.v1",
  run: (payload: unknown, ctx) =>
    execute("core.commissions.settle.v1", ctx, (engine) =>
      engine.settleCommissions(payload),
    ),
});

export const reconcileUsageTask = defineTask({
  id: "core.reconciliation.usage.v1",
  run: (payload: unknown, ctx) =>
    execute("core.reconciliation.usage.v1", ctx, (engine) =>
      engine.reconcileUsage(payload),
    ),
});

export const threeWayReconciliationTask = defineTask({
  id: "core.reconciliation.three-way.v1",
  run: (payload: unknown, ctx) =>
    execute("core.reconciliation.three-way.v1", ctx, (engine) =>
      engine.reconcileThreeWay(payload),
    ),
});

export const exportReportTask = defineTask({
  id: "core.reporting.export.v1",
  run: (payload: unknown, ctx) =>
    execute("core.reporting.export.v1", ctx, (engine) =>
      engine.exportReport(payload),
    ),
});
