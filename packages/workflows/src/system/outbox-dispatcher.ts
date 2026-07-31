import type { ClaimedOutboxMessage } from "@clockwork/db";

export interface OutboxDispatcherStore {
  claimNext(input: {
    workerId: string;
    topics?: readonly string[];
  }): Promise<ClaimedOutboxMessage | null>;
  complete(message: ClaimedOutboxMessage): Promise<void>;
  fail(message: ClaimedOutboxMessage): Promise<void>;
}

export type OutboxTopicHandler = (input: {
  messageId: string;
  eventId: string;
  topic: string;
  payload: unknown;
  idempotencyKey: string;
}) => Promise<void>;

export class DurableOutboxDispatcher {
  public constructor(
    private readonly store: OutboxDispatcherStore,
    private readonly handlers: ReadonlyMap<string, OutboxTopicHandler>,
  ) {
    if (handlers.size === 0)
      throw new Error("OUTBOX_TOPIC_HANDLERS_NOT_CONFIGURED");
  }

  public async dispatchOne(
    workerId: string,
  ): Promise<
    | { status: "idle" }
    | { status: "delivered"; messageId: string; topic: string }
  > {
    const message = await this.store.claimNext({
      workerId,
      topics: [...this.handlers.keys()].sort(),
    });
    if (!message) return { status: "idle" };
    const handler = this.handlers.get(message.topic);
    if (!handler) {
      await this.store.fail(message);
      throw new Error(`OUTBOX_TOPIC_NOT_CONFIGURED:${message.topic}`);
    }
    try {
      await handler({
        messageId: message.id,
        eventId: message.eventId,
        topic: message.topic,
        payload: message.payload,
        idempotencyKey: `outbox:${message.id}`,
      });
      await this.store.complete(message);
      return {
        status: "delivered",
        messageId: message.id,
        topic: message.topic,
      };
    } catch (error) {
      await this.store.fail(message);
      throw error;
    }
  }

  /**
   * Drain a bounded batch so a quiet polling interval does not serialize each
   * message into a separate Trigger run. The limit also prevents one busy
   * tenant from monopolizing a worker indefinitely.
   */
  public async dispatchBatch(
    workerId: string,
    maxMessages = 100,
  ): Promise<{ delivered: number; idle: boolean }> {
    if (
      !Number.isSafeInteger(maxMessages) ||
      maxMessages < 1 ||
      maxMessages > 1000
    )
      throw new Error("OUTBOX_BATCH_LIMIT_INVALID");
    let delivered = 0;
    while (delivered < maxMessages) {
      const result = await this.dispatchOne(`${workerId}:${delivered}`);
      if (result.status === "idle") return { delivered, idle: true };
      delivered += 1;
    }
    return { delivered, idle: false };
  }
}

let configuredDispatcher: DurableOutboxDispatcher | undefined;

export function configureOutboxDispatcher(
  dispatcher: DurableOutboxDispatcher,
): void {
  if (configuredDispatcher && configuredDispatcher !== dispatcher)
    throw new Error("OUTBOX_DISPATCHER_ALREADY_CONFIGURED");
  configuredDispatcher = dispatcher;
}

export function resetOutboxDispatcherForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("OUTBOX_DISPATCHER_RESET_FORBIDDEN");
  configuredDispatcher = undefined;
}

export function executeConfiguredOutboxDispatcher(workerId: string) {
  if (!configuredDispatcher)
    throw new Error("OUTBOX_DISPATCHER_NOT_CONFIGURED");
  return configuredDispatcher.dispatchBatch(workerId);
}
