import { DatabasePaygBillingRepository } from "../core/database-payg";
import { configurePaygScheduleRepository } from "../core/payg-scheduled-runtime";
import { configurePriceBookScheduleRepository } from "../core/price-book-scheduled-runtime";
import { DatabasePriceBookScheduleRepository } from "@clockwork/db";
import {
  configureDatabaseTransactionInstrumentation,
  DatabaseSystemCapabilityAdmin,
  DatabaseSystemCapabilityGuard,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  ClockworkTelemetry,
  OtlpHttpTelemetrySink,
  RuntimeBoundaryInstrumentation,
} from "@clockwork/integrations";

import {
  createProductionWorkflowRuntime,
  type ProductionWorkflowRuntimeInput,
} from "./production";
import { deriveWorkflowCapabilityProfile } from "./capability-profile";
import {
  createEnvironmentWorkflowAdapterFactory,
  WorkflowEnvironmentAdapterConfigurationError,
} from "./environment-production-adapters";

/**
 * The half of the bootstrap no queue vendor appears in.
 *
 * Whoever hosts the tasks -- the Trigger worker, or the web process draining
 * SQS -- brings its own database pool and its own environment validation, and
 * then builds the same runtime from the same adapters through here. The
 * activation singleton lives here too, so a process that hosts both paths
 * activates once.
 */
export type ProductionWorkflowRuntime = ReturnType<
  typeof createProductionWorkflowRuntime
>;

export interface WorkflowRuntimeEnvironment {
  runtimeEnvironment: "development" | "test" | "production";
}

export type WorkflowRuntimeEnvironmentSource = Readonly<
  Record<string, string | undefined>
>;

export class WorkflowBootstrapConfigurationError extends Error {
  public readonly code = "WORKFLOW_BOOTSTRAP_INCOMPLETE";

  public constructor(
    public readonly missing: readonly string[],
    public readonly externalGates: readonly string[],
  ) {
    super(`WORKFLOW_BOOTSTRAP_INCOMPLETE:${missing.join(",")}`);
    this.name = "WorkflowBootstrapConfigurationError";
  }
}

export function validateWorkflowRuntimeEnvironment(
  source: WorkflowRuntimeEnvironmentSource,
): WorkflowRuntimeEnvironment {
  const runtimeEnvironment = source.NODE_ENV?.trim();
  if (
    !runtimeEnvironment ||
    !["development", "test", "production"].includes(runtimeEnvironment)
  )
    throw new WorkflowBootstrapConfigurationError(["NODE_ENV"], ["EXT-ACC-01"]);
  return {
    runtimeEnvironment:
      runtimeEnvironment as WorkflowRuntimeEnvironment["runtimeEnvironment"],
  };
}

export type ProductionWorkflowAdapterBundle = Omit<
  ProductionWorkflowRuntimeInput,
  "db"
>;

export interface ProductionWorkflowAdapterFactory {
  create(input: {
    db: RuntimeDatabase;
    environment: WorkflowRuntimeEnvironment;
    source: WorkflowRuntimeEnvironmentSource;
  }): Promise<ProductionWorkflowAdapterBundle>;
}

export interface CreateWorkflowRuntimeInput {
  db: RuntimeDatabase;
  source?: WorkflowRuntimeEnvironmentSource;
  adapterFactory?: ProductionWorkflowAdapterFactory;
  readCapabilities?: (db: RuntimeDatabase) => Promise<
    readonly {
      capabilityKey: string;
      enabled: boolean;
      recoveryEnabled: boolean;
    }[]
  >;
}

export async function createWorkflowRuntime(
  input: CreateWorkflowRuntimeInput,
): Promise<ProductionWorkflowRuntime> {
  const source = input.source ?? process.env;
  const environment = validateWorkflowRuntimeEnvironment(source);
  const { db } = input;
  const telemetryEnvironment = {
    ...source,
    ...(!source.OTEL_EXPORTER_OTLP_ENDPOINT &&
    !source.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      ? { OTEL_SDK_DISABLED: "true" }
      : {}),
  };
  const telemetry = new ClockworkTelemetry(
    new OtlpHttpTelemetrySink({
      environment: telemetryEnvironment,
      runtimeEnvironment: environment.runtimeEnvironment,
    }),
  );
  const instrumentation = new RuntimeBoundaryInstrumentation(telemetry);
  configureDatabaseTransactionInstrumentation({
    trace: (transaction) =>
      instrumentation.db({
        name: `db.${transaction.kind}_transaction`,
        correlation: { requestId: transaction.requestId },
        attributes: {
          "clockwork.operation": `db.${transaction.kind}_transaction`,
          "db.operation.name": transaction.kind,
          "db.system.name": "postgresql",
        },
        operation: () => transaction.operation(),
      }),
  });
  let adapterFactory = input.adapterFactory;
  if (!adapterFactory) {
    const capabilities = input.readCapabilities
      ? await input.readCapabilities(db)
      : await new DatabaseSystemCapabilityAdmin(db).list({
          requestId: `workflow-bootstrap:capabilities:${crypto.randomUUID()}`,
        });
    try {
      adapterFactory = createEnvironmentWorkflowAdapterFactory(
        source,
        instrumentation,
        telemetry,
        deriveWorkflowCapabilityProfile(capabilities),
      );
    } catch (error) {
      if (error instanceof WorkflowEnvironmentAdapterConfigurationError)
        throw new WorkflowBootstrapConfigurationError(
          error.missing,
          error.externalGates,
        );
      throw error;
    }
  }
  const adapters = await adapterFactory.create({ db, environment, source });
  configurePriceBookScheduleRepository(
    new DatabasePriceBookScheduleRepository(db),
  );
  configurePaygScheduleRepository({
    billingMonths: (now) =>
      new DatabasePaygBillingRepository(db).billingMonths(now),
    closeMonth: async (period) => {
      const capability = await new DatabaseSystemCapabilityGuard(db).require({
        capabilities: ["billing"],
        recovery: false,
        requestId: `payg-schedule:${period.month}`,
      });
      if (!capability.allowed)
        throw new Error("PAYG_BILLING_CAPABILITY_DISABLED");
      return new DatabasePaygBillingRepository(db).closeMonth(period);
    },
  });
  return createProductionWorkflowRuntime({
    db,
    ...adapters,
    instrumentation,
  });
}

export interface ActivatableWorkflowRuntime {
  activate(): void;
}

let activation:
  | { status: "activating"; promise: Promise<ActivatableWorkflowRuntime> }
  | { status: "active"; promise: Promise<ActivatableWorkflowRuntime> }
  | undefined;

export function workflowRuntimeStatus(): "inactive" | "activating" | "active" {
  return activation?.status ?? "inactive";
}

export function activateWorkflowRuntime(
  load: () => Promise<ActivatableWorkflowRuntime>,
): Promise<ActivatableWorkflowRuntime> {
  if (activation) return activation.promise;
  const promise = Promise.resolve()
    .then(load)
    .then((runtime) => {
      runtime.activate();
      activation = { status: "active", promise };
      return runtime;
    })
    .catch((error: unknown) => {
      activation = undefined;
      throw error;
    });
  activation = { status: "activating", promise };
  return promise;
}

export function resetWorkflowRuntimeBootstrapForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("WORKFLOW_BOOTSTRAP_RESET_FORBIDDEN");
  activation = undefined;
}
