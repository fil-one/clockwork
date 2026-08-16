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
import { composedTaxProvider } from "@/src/providers/tax";

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
    // The third site of the same over-broad gate already corrected in the API
    // composition and in webhook replay. The tax port reaches exactly one of
    // these handlers -- `DatabaseAuthoritativePortalCommandExecutor` -- while
    // the projection materializer and the five `experience.*` acknowledgement
    // handlers never ask it anything. `requiredTaxProvider()` throws while this
    // argument list is being built, so an unwired EXT-TAX-01 took down the
    // whole drain, materialization included, before a single message was
    // dispatched. That is not hypothetical under the release harness:
    // `isolatedReleaseEnvironment` deletes every `.env.example` name from the
    // inherited environment, both tax variables are documented there, and the
    // `proof` shard re-supplies neither. `composedTaxProvider()` keeps the
    // refusal on the commands that can write a `tax_minor` and lets the rest of
    // the drain run.
    const dispatcher = new DurableOutboxDispatcher(
      new DatabaseOutboxDispatcherStore(runtime.db),
      createProductionExperienceOutboxHandlers({
        database: runtime.db,
        authorizationSecret,
        tax: composedTaxProvider(),
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
