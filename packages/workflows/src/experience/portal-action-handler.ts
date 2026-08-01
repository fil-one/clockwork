import type { Actor } from "@clockwork/contracts";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";

export const portalActionQueuedTopic =
  "experience.projection_action.queued" as const;

const PortalActionQueuedPayloadSchema = z
  .object({
    eventId: z.uuid(),
    actionRequestId: z.uuid(),
    projectionId: z.uuid(),
    aggregateType: z.string().trim().min(1).max(80),
    aggregateId: z.uuid(),
    action: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export interface PersistedPortalActionRequest {
  id: string;
  projectionId: string;
  aggregateType: string;
  aggregateId: string;
  commandResource: string;
  action: string;
  expectedVersion: number;
  actor: Actor;
  effectiveAccountId: string | null;
  assistedSessionId: string | null;
  assistedReason: string | null;
  mfaVerified: boolean;
  recentAuthenticationVerified: boolean;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export type PortalActionTerminalStatus = "applied" | "rejected" | "failed";

export interface PortalActionTerminalOutcome {
  status: PortalActionTerminalStatus;
  code: string;
  resultReference: string;
  authoritativeVersion: number | null;
  commandReplayed: boolean | null;
}

export interface PortalActionCompletionOutcome extends Omit<
  PortalActionTerminalOutcome,
  "commandReplayed"
> {
  commandReplayed: boolean;
}

export type PortalActionClaim =
  | { status: "missing" }
  | { status: "busy"; retryAt: string }
  | {
      status: "terminal";
      actionRequestId: string;
      outcome: PortalActionTerminalOutcome;
    }
  | {
      status: "claimed";
      claimToken: string;
      attempt: number;
      request: PersistedPortalActionRequest;
    };

export interface PortalActionPersistencePort {
  /** Claim must be exclusive, leased, and idempotent by actionRequestId. */
  claim(input: {
    actionRequestId: string;
    eventId: string;
    messageId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<PortalActionClaim>;

  /**
   * Atomically transition the claimed request to its terminal state and append
   * the matching audit event and outbox message. Projection rows are forbidden
   * in this transaction; they are updated only by the materializer.
   */
  finish(input: {
    actionRequestId: string;
    claimToken: string;
    eventId: string;
    requestId: string;
    completedAt: Date;
    outcome: PortalActionCompletionOutcome;
  }): Promise<PortalActionTerminalOutcome>;

  /**
   * Release a non-terminal claim after an infrastructure/retryable failure and
   * atomically append sanitized attempt audit/outbox evidence.
   */
  release(input: {
    actionRequestId: string;
    claimToken: string;
    eventId: string;
    requestId: string;
    releasedAt: Date;
    failureCode: string;
  }): Promise<void>;
}

export type AuthoritativeCommandResult =
  | {
      ok: true;
      aggregateVersion: number;
      resultReference: string;
      replayed: boolean;
    }
  | {
      ok: false;
      code: string;
      resultReference: string;
      authoritativeVersion: number | null;
      disposition: "rejected" | "failed";
      retryable: boolean;
    };

export interface AuthoritativePortalCommandPort {
  /**
   * The authoritative implementation must recover an exact completed
   * idempotency result before rejecting stale authorization or aggregate
   * versions, then revalidate current authority and enforce expectedVersion in
   * the mutation transaction. This ordering closes the post-commit/pre-receipt
   * crash window without weakening authorization for a new command.
   */
  execute(input: {
    commandResource: string;
    action: string;
    aggregateType: string;
    aggregateId: string;
    expectedVersion: number;
    payload: Readonly<Record<string, unknown>>;
    actor: Actor;
    effectiveAccountId: string | null;
    assistedSessionId: string | null;
    assistedReason: string | null;
    mfaVerified: boolean;
    recentAuthenticationVerified: boolean;
    authorizationCreatedAt: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AuthoritativeCommandResult>;
}

export type PortalActionHandlerResult =
  | {
      status: "terminal";
      actionRequestId: string;
      replayed: true;
      outcome: PortalActionTerminalOutcome;
    }
  | {
      status: "completed";
      actionRequestId: string;
      replayed: false;
      outcome: PortalActionTerminalOutcome;
    };

function safeCode(value: string, fallback: string): string {
  const code = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_.-]{2,100}$/.test(code) ? code : fallback;
}

function validReference(value: string): boolean {
  return value.trim().length >= 8 && value.trim().length <= 512;
}

function eventBindingIsValid(
  request: PersistedPortalActionRequest,
  event: z.infer<typeof PortalActionQueuedPayloadSchema>,
): boolean {
  return (
    request.id === event.actionRequestId &&
    request.projectionId === event.projectionId &&
    request.aggregateType === event.aggregateType &&
    request.aggregateId === event.aggregateId &&
    request.action === event.action &&
    request.expectedVersion === event.expectedVersion &&
    request.actor.kind === "user" &&
    request.commandResource.trim().length > 0 &&
    request.idempotencyKey.trim().length >= 16
  );
}

export class PortalActionRetryableError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "PortalActionRetryableError";
  }
}

export class PortalActionHandler {
  public constructor(
    private readonly persistence: PortalActionPersistencePort,
    private readonly commands: AuthoritativePortalCommandPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async handle(input: {
    messageId: string;
    eventId: string;
    topic: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<PortalActionHandlerResult> {
    if (input.topic !== portalActionQueuedTopic)
      throw new Error("PORTAL_ACTION_TOPIC_INVALID");
    const event = PortalActionQueuedPayloadSchema.parse(input.payload);
    if (event.eventId !== input.eventId)
      throw new Error("PORTAL_ACTION_EVENT_ID_MISMATCH");
    const claimed = await this.persistence.claim({
      actionRequestId: event.actionRequestId,
      eventId: input.eventId,
      messageId: input.messageId,
      idempotencyKey: input.idempotencyKey,
      now: this.clock(),
    });
    if (claimed.status === "missing")
      throw new Error("PORTAL_ACTION_REQUEST_NOT_FOUND");
    if (claimed.status === "busy")
      throw new PortalActionRetryableError("PORTAL_ACTION_REQUEST_BUSY");
    if (claimed.status === "terminal")
      return {
        status: "terminal",
        actionRequestId: claimed.actionRequestId,
        replayed: true,
        outcome: claimed.outcome,
      };

    const finish = async (
      outcome: PortalActionCompletionOutcome,
    ): Promise<PortalActionHandlerResult> => ({
      status: "completed",
      actionRequestId: claimed.request.id,
      replayed: false,
      outcome: await this.persistence.finish({
        actionRequestId: claimed.request.id,
        claimToken: claimed.claimToken,
        eventId: input.eventId,
        requestId: input.idempotencyKey,
        completedAt: this.clock(),
        outcome,
      }),
    });

    try {
      if (!eventBindingIsValid(claimed.request, event))
        return await finish({
          status: "failed",
          code: "PORTAL_ACTION_EVENT_BINDING_INVALID",
          resultReference: `action-request:${claimed.request.id}:binding`,
          authoritativeVersion: null,
          commandReplayed: false,
        });

      const result = await this.commands.execute({
        commandResource: claimed.request.commandResource,
        action: claimed.request.action,
        aggregateType: claimed.request.aggregateType,
        aggregateId: claimed.request.aggregateId,
        expectedVersion: claimed.request.expectedVersion,
        payload: claimed.request.payload,
        actor: claimed.request.actor,
        effectiveAccountId: claimed.request.effectiveAccountId,
        assistedSessionId: claimed.request.assistedSessionId,
        assistedReason: claimed.request.assistedReason,
        mfaVerified: claimed.request.mfaVerified,
        recentAuthenticationVerified:
          claimed.request.recentAuthenticationVerified,
        authorizationCreatedAt: claimed.request.createdAt,
        idempotencyKey: claimed.request.id,
        requestId: input.idempotencyKey,
      });
      if (!result.ok) {
        const code = safeCode(result.code, "PORTAL_ACTION_COMMAND_FAILED");
        if (result.retryable) throw new PortalActionRetryableError(code);
        return await finish({
          status: result.disposition,
          code,
          resultReference: validReference(result.resultReference)
            ? result.resultReference.trim()
            : `action-request:${claimed.request.id}:${result.disposition}`,
          authoritativeVersion: result.authoritativeVersion,
          commandReplayed: false,
        });
      }
      if (
        result.aggregateVersion < claimed.request.expectedVersion ||
        !validReference(result.resultReference)
      )
        return await finish({
          status: "failed",
          code: "AUTHORITATIVE_COMMAND_RESULT_INVALID",
          resultReference: `action-request:${claimed.request.id}:invalid-result`,
          authoritativeVersion: result.aggregateVersion,
          commandReplayed: result.replayed,
        });
      return await finish({
        status: "applied",
        code: "PORTAL_ACTION_APPLIED",
        resultReference: result.resultReference.trim(),
        authoritativeVersion: result.aggregateVersion,
        commandReplayed: result.replayed,
      });
    } catch (error) {
      const failureCode =
        error instanceof PortalActionRetryableError
          ? error.code
          : "PORTAL_ACTION_INFRASTRUCTURE_FAILURE";
      try {
        await this.persistence.release({
          actionRequestId: claimed.request.id,
          claimToken: claimed.claimToken,
          eventId: input.eventId,
          requestId: input.idempotencyKey,
          releasedAt: this.clock(),
          failureCode,
        });
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "PORTAL_ACTION_FAILURE_RELEASE_FAILED",
        );
      }
      throw error;
    }
  }
}

export function createPortalActionOutboxHandlers(input: {
  persistence: PortalActionPersistencePort;
  commands: AuthoritativePortalCommandPort;
  clock?: () => Date;
}): ReadonlyMap<string, OutboxTopicHandler> {
  const handler = new PortalActionHandler(
    input.persistence,
    input.commands,
    input.clock,
  );
  return new Map([
    [
      portalActionQueuedTopic,
      (delivery) => handler.handle(delivery).then(() => {}),
    ],
  ]);
}
