import {
  configureDatabaseTransactionInstrumentation,
  createRuntimeDatabase,
  DatabaseOutboxDispatcherStore,
} from "@clockwork/db";
import {
  ClockworkTelemetry,
  OtlpHttpTelemetrySink,
  RuntimeBoundaryInstrumentation,
} from "@clockwork/integrations/telemetry";
import {
  createProductionExperienceOutboxHandlers,
  DurableOutboxDispatcher,
} from "@clockwork/workflows";

const telemetry = new ClockworkTelemetry(
  new OtlpHttpTelemetrySink({
    environment: process.env,
    runtimeEnvironment: "production",
    allowInsecureLocalhost: process.env.CLOCKWORK_RELEASE_PROOF === "1",
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

export async function drainProductionExperienceOutbox(workerId: string) {
  const databaseUrl = process.env.CLOCKWORK_SERVICE_DATABASE_URL;
  const authorizationSecret = process.env.AUTHORIZATION_CONTEXT_SECRET;
  if (!databaseUrl)
    throw new Error(
      "CLOCKWORK_SERVICE_DATABASE_URL is required for workflow proof",
    );
  if (!authorizationSecret || Buffer.byteLength(authorizationSecret) < 32)
    throw new Error(
      "AUTHORIZATION_CONTEXT_SECRET is required for workflow proof",
    );
  const runtime = createRuntimeDatabase({
    url: databaseUrl,
    role: "clockwork_service",
  });
  const clock = () => new Date();
  try {
    const dispatcher = new DurableOutboxDispatcher(
      new DatabaseOutboxDispatcherStore(runtime.db, { clock }),
      createProductionExperienceOutboxHandlers({
        database: runtime.db,
        authorizationSecret,
        clock,
      }),
      instrumentation,
    );
    return await instrumentation.workflow({
      name: "workflow.experience_outbox.drain",
      correlation: {
        requestId: `workflow:${workerId}`,
        workflowId: "experience-outbox-drain",
        taskId: workerId,
      },
      attributes: {
        "clockwork.operation": "workflow.execute",
        "workflow.name": "experience-outbox-drain",
        "workflow.attempt": 1,
      },
      operation: () => dispatcher.dispatchBatch(workerId, 100),
    });
  } finally {
    await runtime.client.end();
  }
}
