import type { IdempotencyKey } from "@clockwork/contracts";

import { canonicalJson, deterministicUuid } from "./determinism";
import type {
  CoreWorkflowRecord,
  CoreWorkflowRecordPort,
  WorkflowClaim,
  WorkflowClaimRequest,
  WorkflowExceptionPort,
  WorkflowExceptionRequest,
  WorkflowRunStore,
} from "./ports";

type MemoryRun = {
  payloadHash: string;
  status: "running" | "retrying" | "completed" | "permanent_failure";
  attempt: number;
  output?: unknown;
  failureCode?: string;
  retryAfterMs?: number;
};

/** Deterministic test/local implementation with production claim semantics. */
export class InMemoryWorkflowRunStore implements WorkflowRunStore {
  private readonly runs = new Map<IdempotencyKey, MemoryRun>();

  public claim(request: WorkflowClaimRequest): Promise<WorkflowClaim> {
    const existing = this.runs.get(request.invocationKey);
    if (!existing) {
      this.runs.set(request.invocationKey, {
        payloadHash: request.payloadHash,
        status: "running",
        attempt: 1,
      });
      return Promise.resolve({ status: "acquired", attempt: 1 });
    }
    if (existing.payloadHash !== request.payloadHash) {
      return Promise.resolve({
        status: "payload_conflict",
        existingPayloadHash: existing.payloadHash,
      });
    }
    if (existing.status === "completed") {
      return Promise.resolve({ status: "completed", output: existing.output });
    }
    if (existing.status === "running") {
      return Promise.resolve({ status: "in_progress" });
    }
    if (existing.status === "permanent_failure" && !request.replay) {
      return Promise.resolve({
        status: "permanent_failure",
        output: existing.output,
      });
    }

    existing.status = "running";
    existing.attempt += 1;
    return Promise.resolve({ status: "acquired", attempt: existing.attempt });
  }

  public markCompleted(input: {
    invocationKey: IdempotencyKey;
    output: unknown;
    completedAt: string;
  }): Promise<void> {
    const run = this.required(input.invocationKey);
    run.status = "completed";
    run.output = input.output;
    delete run.failureCode;
    delete run.retryAfterMs;
    return Promise.resolve();
  }

  public markRetrying(input: {
    invocationKey: IdempotencyKey;
    code: string;
    retryAfterMs?: number;
    failedAt: string;
  }): Promise<void> {
    const run = this.required(input.invocationKey);
    run.status = "retrying";
    run.failureCode = input.code;
    if (input.retryAfterMs === undefined) delete run.retryAfterMs;
    else run.retryAfterMs = input.retryAfterMs;
    return Promise.resolve();
  }

  public markPermanentFailure(input: {
    invocationKey: IdempotencyKey;
    output: unknown;
    failedAt: string;
  }): Promise<void> {
    const run = this.required(input.invocationKey);
    run.status = "permanent_failure";
    run.output = input.output;
    return Promise.resolve();
  }

  public inspect(
    invocationKey: IdempotencyKey,
  ): Readonly<MemoryRun> | undefined {
    const value = this.runs.get(invocationKey);
    return value ? { ...value } : undefined;
  }

  private required(invocationKey: IdempotencyKey): MemoryRun {
    const value = this.runs.get(invocationKey);
    if (!value)
      throw new Error(
        "Workflow run must be claimed before recording an outcome",
      );
    return value;
  }
}

export class InMemoryWorkflowExceptionPort implements WorkflowExceptionPort {
  public readonly cases: Array<WorkflowExceptionRequest & { caseId: string }> =
    [];

  public open(request: WorkflowExceptionRequest): Promise<{
    caseId: string;
    duplicate?: boolean;
  }> {
    const existing = this.cases.find(
      (item) => item.exceptionKey === request.exceptionKey,
    );
    if (existing)
      return Promise.resolve({ caseId: existing.caseId, duplicate: true });
    const caseId = deterministicUuid(`exception:${request.exceptionKey}`);
    this.cases.push({ ...request, caseId });
    return Promise.resolve({ caseId });
  }
}

export class InMemoryCoreWorkflowRecordPort implements CoreWorkflowRecordPort {
  public readonly records: Array<{
    invocationKey: IdempotencyKey;
    aggregateId: string;
    aggregateVersion: number;
    requestId: string;
    occurredAt: string;
    record: CoreWorkflowRecord;
  }> = [];

  public record(
    input: Parameters<CoreWorkflowRecordPort["record"]>[0],
  ): Promise<{ duplicate?: boolean }> {
    const existing = this.records.find(
      (item) => item.invocationKey === input.invocationKey,
    );
    if (existing) {
      if (canonicalJson(existing.record) !== canonicalJson(input.record))
        throw new Error("Workflow record idempotency conflict");
      return Promise.resolve({ duplicate: true });
    }
    this.records.push(input);
    return Promise.resolve({});
  }
}
