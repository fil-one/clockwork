import {
  DatabaseLifecycleCommandRepository,
  DatabaseRoleSynchronizationSink,
  DatabaseStripeFinancialProjection,
  type DatabaseWebhookReplayTaskStore,
  type LifecycleExceptionRoutingPort,
  type RuntimeDatabase,
  type VerifiedWebhookReplayPayload,
} from "@clockwork/db";
import type { TaxPort } from "@clockwork/contracts";
import {
  normalizedStripeEventFromPayload,
  synchronizeWorkosRoleEvent,
} from "@clockwork/integrations";
import { z } from "zod";

export interface WebhookReplayHandler {
  apply(event: VerifiedWebhookReplayPayload): Promise<void>;
}

const StoredRecordSchema = z.record(z.string(), z.unknown());

function stripePayloadWithRedactedRawObject(payload: unknown): unknown {
  const envelope = StoredRecordSchema.parse(payload);
  const event = StoredRecordSchema.parse(envelope.event);
  return { ...envelope, event: { ...event, rawObject: {} } };
}

/** Reuses the same durable projections as verified HTTP ingress. */
export class ProductionWebhookReplayHandler implements WebhookReplayHandler {
  private readonly stripe: DatabaseStripeFinancialProjection;
  private readonly roles: DatabaseRoleSynchronizationSink;
  private readonly lifecycle: DatabaseLifecycleCommandRepository;

  public constructor(input: {
    database: RuntimeDatabase;
    authorizationSecret: string;
    tax: TaxPort;
    exceptionRouting: LifecycleExceptionRoutingPort;
  }) {
    this.stripe = new DatabaseStripeFinancialProjection(input.database);
    this.roles = new DatabaseRoleSynchronizationSink(input.database);
    this.lifecycle = new DatabaseLifecycleCommandRepository({
      database: input.database,
      serviceDatabase: input.database,
      authorizationSecret: input.authorizationSecret,
      tax: input.tax,
      exceptionRouting: input.exceptionRouting,
      policies: {
        // Webhook commands do not consult interactive lifecycle policy. These
        // closed values prevent this worker-only composition from widening it.
        clickThroughThresholdMinor: "0",
        migrationFeatureEnabled: false,
        automatedTeardownEnabled: false,
        exceptionQueues: [],
      },
    });
  }

  public async apply(event: VerifiedWebhookReplayPayload): Promise<void> {
    if (event.provider === "stripe") {
      const normalized = normalizedStripeEventFromPayload(
        stripePayloadWithRedactedRawObject(event.payload),
      );
      if (
        normalized.eventId !== event.providerEventId ||
        normalized.eventType !== event.eventType
      )
        throw new Error("WEBHOOK_REPLAY_STRIPE_BINDING_INVALID");
      await this.stripe.apply(normalized);
      return;
    }
    if (event.provider === "workos") {
      const payload = StoredRecordSchema.parse(event.payload);
      if (
        payload.id !== event.providerEventId ||
        payload.event !== event.eventType
      )
        throw new Error("WEBHOOK_REPLAY_WORKOS_BINDING_INVALID");
      await synchronizeWorkosRoleEvent(payload, this.roles);
      return;
    }
    if (event.provider === "esign" || event.provider === "provisioning") {
      await this.lifecycle.executeInTransaction({
        command:
          event.provider === "esign"
            ? "ingest_signature_event"
            : "ingest_provisioning_event",
        payload: event.payload,
        context: this.context(event),
      });
      return;
    }
    if (event.provider.startsWith("marketplace:")) {
      const provider = event.provider.slice("marketplace:".length);
      const payload = StoredRecordSchema.parse(event.payload);
      if (payload.provider !== provider || payload.type !== event.eventType)
        throw new Error("WEBHOOK_REPLAY_MARKETPLACE_BINDING_INVALID");
      await this.lifecycle.executeInTransaction({
        command: "ingest_marketplace_event",
        payload,
        context: this.context(event),
      });
      return;
    }
    if (event.provider.startsWith("support:")) {
      const provider = event.provider.slice("support:".length);
      const payload = StoredRecordSchema.parse(event.payload);
      if (payload.provider !== provider || payload.type !== event.eventType)
        throw new Error("WEBHOOK_REPLAY_SUPPORT_BINDING_INVALID");
      // Support ingress records receipt only; successful replay has the same
      // projection and closes the durable inbox failure below.
      return;
    }
    throw new Error("WEBHOOK_REPLAY_PROVIDER_UNSUPPORTED");
  }

  private context(event: VerifiedWebhookReplayPayload) {
    return {
      requestId: `webhook-replay:${event.workflowRunId}`,
      actor: { kind: "provider" as const, id: event.provider },
      idempotencyKey: `${event.provider}:${event.providerEventId}`,
      ip: null,
      userAgent: null,
      occurredAt: event.occurredAt,
      authorization: null,
    };
  }
}

export interface WebhookReplayTaskInvocation {
  workflowRunId: string;
  triggerRunId: string;
  attempt: number;
}

export class DatabaseWebhookReplayRuntime {
  public constructor(
    private readonly store: DatabaseWebhookReplayTaskStore,
    private readonly handler: WebhookReplayHandler,
  ) {}

  public async execute(
    invocation: WebhookReplayTaskInvocation,
  ): Promise<unknown> {
    const claim = await this.store.claim(invocation);
    if (claim.status === "duplicate") return claim.output;
    try {
      await this.handler.apply(claim.event);
      const output = { status: "processed" as const };
      await this.store.complete({
        workflowRunId: invocation.workflowRunId,
        triggerRunId: invocation.triggerRunId,
        output,
      });
      return output;
    } catch (error) {
      await this.store.fail(invocation);
      throw error;
    }
  }
}

let configuredRuntime: DatabaseWebhookReplayRuntime | undefined;

export function configureWebhookReplayRuntime(
  runtime: DatabaseWebhookReplayRuntime,
): void {
  if (configuredRuntime && configuredRuntime !== runtime)
    throw new Error("WEBHOOK_REPLAY_RUNTIME_ALREADY_CONFIGURED");
  configuredRuntime = runtime;
}

export function resetWebhookReplayRuntimeForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("WEBHOOK_REPLAY_RUNTIME_RESET_FORBIDDEN");
  configuredRuntime = undefined;
}

export function executeConfiguredWebhookReplay(
  invocation: WebhookReplayTaskInvocation,
): Promise<unknown> {
  if (!configuredRuntime)
    throw new Error("WEBHOOK_REPLAY_RUNTIME_NOT_CONFIGURED");
  return configuredRuntime.execute(invocation);
}
