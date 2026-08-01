import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { ProblemError } from "@clockwork/contracts";
import { authorizationActor } from "@clockwork/domain";
import {
  assertExternalGateTransition,
  evaluateExternalGate,
  externalGateActivationTestIsCurrent,
  externalGateRequiresLiveSignedInput,
  ExternalGatePolicyError,
  externalGateKeys,
  sanitizeActivationEvidenceReference,
  type ActivationTestRunner,
  type ExternalGateActivationTestResult,
  type ExternalGateRecord,
  type ExternalGateView,
} from "@clockwork/domain/system";

import {
  requirePermission,
  requireRecentAuthentication,
} from "../../auth/authorize";
import type { ApiVariables } from "../../context";

const GateKeySchema = z.enum(externalGateKeys);
const ConfiguredStatusSchema = z.enum([
  "blocked",
  "review",
  "pending",
  "active",
  "not_required",
]);
const SimulatorStateSchema = z.enum(["ready", "degraded", "unavailable"]);
const ActivationTestStatusSchema = z.enum(["never", "passed", "failed"]);
const InputProvenanceSchema = z.enum([
  "unverified",
  "repository_fixture",
  "live_signed",
]);
const NullableInstantSchema = z.iso.datetime({ offset: true }).nullable();
const NullableDateSchema = z.iso.date().nullable();

export const ExternalGateViewSchema = z
  .object({
    id: z.uuid(),
    gateKey: GateKeySchema,
    title: z.string().min(1),
    owner: z.string().min(1),
    inputRequired: z.string().min(1),
    affectedFeature: z.string().min(1),
    severity: z.string().min(1),
    configuredStatus: ConfiguredStatusSchema,
    effectiveStatus: ConfiguredStatusSchema,
    simulatorState: SimulatorStateSchema,
    simulatorDetails: z.string().min(1),
    inputProvenance: InputProvenanceSchema,
    lastActivationTestStatus: ActivationTestStatusSchema,
    lastActivationTestAt: NullableInstantSchema,
    lastActivationTestedBy: z.string().min(1).nullable(),
    activationEvidenceReference: z.string().min(1).nullable(),
    reviewOn: NullableDateSchema,
    statusReason: z.string().min(1),
    emergencyDisabledAt: NullableInstantSchema,
    emergencyDisabledBy: z.string().min(1).nullable(),
    emergencyDisableReason: z.string().min(8).nullable(),
    emergencyDisableEvidenceReference: z.string().min(1).nullable(),
    activationAllowed: z.boolean(),
    blockedReasons: z.array(z.string()),
    rowVersion: z.number().int().positive(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const ExternalGateUpdateSchema = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    owner: z.string().trim().min(2).max(200),
    inputRequired: z.string().trim().min(8).max(2_000),
    configuredStatus: ConfiguredStatusSchema,
    reviewOn: NullableDateSchema,
    statusReason: z.string().trim().min(8).max(2_000),
  })
  .strict();

const ActivationTestRequestSchema = z
  .object({ expectedRowVersion: z.number().int().positive() })
  .strict();

const EmergencyStateUpdateSchema = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    disabled: z.boolean(),
    reason: z.string().trim().min(8).max(2_000),
    evidenceReference: z.string().trim().min(8).max(512),
  })
  .strict();

const ActivationTaskRequestSchema = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    taskKey: z.string().trim().min(8).max(255),
    provider: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  })
  .strict();

export const ExternalGateActivationTaskReceiptSchema = z
  .object({
    runId: z.string().min(1).max(255),
    taskKey: z.string().min(8).max(255),
    gateKey: GateKeySchema,
    provider: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    expectedGateRowVersion: z.number().int().positive(),
    status: z.enum(["queued", "duplicate"]),
    submittedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const ExceptionRosterUpsertSchema = z
  .object({
    expectedRowVersion: z.number().int().min(0),
    accountId: z.uuid(),
    queue: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    userId: z.uuid(),
    role: z.enum(["primary", "backup", "escalation"]),
    active: z.boolean(),
    qualificationEvidenceReference: z.string().trim().min(8).max(512),
    qualifiedUntil: z.iso.datetime({ offset: true }),
    absentFrom: NullableInstantSchema,
    absentUntil: NullableInstantSchema,
    targetMinutes: z.number().int().min(1).max(43_200),
    priority: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const ExceptionRosterViewSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    queue: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    userId: z.uuid(),
    role: z.enum(["primary", "backup", "escalation"]),
    active: z.boolean(),
    qualificationEvidenceReference: z.string().min(1),
    qualifiedUntil: z.iso.datetime({ offset: true }),
    absentFrom: NullableInstantSchema,
    absentUntil: NullableInstantSchema,
    targetMinutes: z.number().int().min(1).max(43_200),
    priority: z.number().int().min(0).max(1_000_000),
    rowVersion: z.number().int().positive(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const ActivationTestResultSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    testedAt: z.iso.datetime({ offset: true }),
    testedBy: z.string().trim().min(2).max(320),
    evidenceReference: z.string().trim().min(8).max(2_000),
    simulatorState: SimulatorStateSchema,
    simulatorDetails: z.string().trim().min(8).max(2_000),
    inputProvenance: InputProvenanceSchema,
  })
  .strict();

export interface ExternalGateService {
  list(input: { requestId: string; now: Date }): Promise<ExternalGateView[]>;
  get(input: {
    gateKey: z.infer<typeof GateKeySchema>;
    requestId: string;
    now: Date;
  }): Promise<ExternalGateView>;
  update(
    input: z.infer<typeof ExternalGateUpdateSchema> & {
      gateKey: z.infer<typeof GateKeySchema>;
      actor: ReturnType<typeof authorizationActor>;
      requestId: string;
      now: Date;
    },
  ): Promise<ExternalGateView>;
  recordActivationTest(input: {
    gateKey: z.infer<typeof GateKeySchema>;
    expectedRowVersion: number;
    result: ExternalGateActivationTestResult;
    actor: ReturnType<typeof authorizationActor>;
    requestId: string;
    now: Date;
  }): Promise<ExternalGateView>;
  setEmergencyState(
    input: z.infer<typeof EmergencyStateUpdateSchema> & {
      gateKey: z.infer<typeof GateKeySchema>;
      actor: ReturnType<typeof authorizationActor>;
      requestId: string;
      now: Date;
    },
  ): Promise<ExternalGateView>;
}

export interface ExternalGateActivationTaskService {
  /**
   * Submit the durable Trigger task with taskKey as its idempotency key. The
   * implementation must re-check the gate version before provider execution.
   */
  enqueue(input: {
    gateKey: z.infer<typeof GateKeySchema>;
    expectedGateRowVersion: number;
    taskKey: string;
    provider: string;
    idempotencyKey: string;
    actor: ReturnType<typeof authorizationActor>;
    requestId: string;
    now: Date;
  }): Promise<z.infer<typeof ExternalGateActivationTaskReceiptSchema>>;
}

interface ExceptionRosterRecord {
  id: string;
  accountId: string;
  queue: string;
  userId: string;
  role: string;
  active: boolean;
  qualificationEvidenceReference: string;
  qualifiedUntil: Date | string;
  absentFrom: Date | string | null;
  absentUntil: Date | string | null;
  targetMinutes: number;
  priority: number;
  rowVersion: number;
  updatedAt: Date | string;
}

export interface ExceptionRosterAdminService {
  upsert(
    input: Omit<
      z.infer<typeof ExceptionRosterUpsertSchema>,
      "qualifiedUntil" | "absentFrom" | "absentUntil"
    > & {
      rosterEntryId: string;
      qualifiedUntil: Date;
      absentFrom: Date | null;
      absentUntil: Date | null;
      actor: ReturnType<typeof authorizationActor>;
      requestId: string;
      now: Date;
    },
  ): Promise<ExceptionRosterRecord>;
  reassignOpenCase(input: {
    caseId: string;
    requestedBy: string;
    actor: ReturnType<typeof authorizationActor>;
    requestId: string;
    now: Date;
    reason: string;
  }): Promise<ExceptionCaseAssignmentRecord>;
}

interface ExceptionCaseAssignmentRecord {
  id: string;
  accountId: string;
  queue: string;
  status: string;
  ownerUserId: string;
  backupUserId: string | null;
  targetAt: Date | string;
  rowVersion: number;
  updatedAt: Date | string;
}

export interface ExternalGateAdministrationServices {
  activationTasks?: ExternalGateActivationTaskService;
  exceptionRoster?: ExceptionRosterAdminService;
}

export class MemoryExternalGateService implements ExternalGateService {
  private readonly records = new Map<string, ExternalGateRecord>();

  public constructor(records: readonly ExternalGateRecord[] = []) {
    for (const record of records)
      this.records.set(record.gateKey, {
        ...record,
        emergencyDisabledAt: record.emergencyDisabledAt ?? null,
        emergencyDisabledBy: record.emergencyDisabledBy ?? null,
        emergencyDisableReason: record.emergencyDisableReason ?? null,
        emergencyDisableEvidenceReference:
          record.emergencyDisableEvidenceReference ?? null,
      });
  }

  public list(input: { requestId: string; now: Date }) {
    void input.requestId;
    return Promise.resolve(
      [...this.records.values()]
        .sort((left, right) => left.gateKey.localeCompare(right.gateKey))
        .map((record) => evaluateExternalGate(record, input.now)),
    );
  }

  public get(input: Parameters<ExternalGateService["get"]>[0]) {
    void input.requestId;
    const record = this.records.get(input.gateKey);
    if (!record) return Promise.reject(new Error("EXTERNAL_GATE_NOT_FOUND"));
    return Promise.resolve(evaluateExternalGate(record, input.now));
  }

  public update(
    input: Parameters<ExternalGateService["update"]>[0],
  ): Promise<ExternalGateView> {
    const existing = this.records.get(input.gateKey);
    if (!existing) return Promise.reject(new Error("EXTERNAL_GATE_NOT_FOUND"));
    if (existing.rowVersion !== input.expectedRowVersion)
      return Promise.reject(new Error("EXTERNAL_GATE_VERSION_CONFLICT"));
    const updated: ExternalGateRecord = {
      ...existing,
      owner: input.owner,
      inputRequired: input.inputRequired,
      configuredStatus: input.configuredStatus,
      reviewOn: input.reviewOn,
      statusReason: input.statusReason,
      rowVersion: existing.rowVersion + 1,
      updatedAt: input.now.toISOString(),
    };
    assertExternalGateTransition(updated, input.now);
    this.records.set(input.gateKey, updated);
    return Promise.resolve(evaluateExternalGate(updated, input.now));
  }

  public recordActivationTest(
    input: Parameters<ExternalGateService["recordActivationTest"]>[0],
  ): Promise<ExternalGateView> {
    const existing = this.records.get(input.gateKey);
    if (!existing) return Promise.reject(new Error("EXTERNAL_GATE_NOT_FOUND"));
    if (existing.rowVersion !== input.expectedRowVersion)
      return Promise.reject(new Error("EXTERNAL_GATE_VERSION_CONFLICT"));
    const result = input.result;
    const testAllowsActivation =
      result.status === "passed" &&
      result.simulatorState === "ready" &&
      (!externalGateRequiresLiveSignedInput(input.gateKey) ||
        result.inputProvenance === "live_signed") &&
      externalGateActivationTestIsCurrent(result.testedAt, input.now);
    const updated: ExternalGateRecord = {
      ...existing,
      configuredStatus:
        existing.configuredStatus === "active" && !testAllowsActivation
          ? "blocked"
          : existing.configuredStatus,
      simulatorState: result.simulatorState,
      simulatorDetails: result.simulatorDetails,
      inputProvenance: result.inputProvenance,
      lastActivationTestStatus: result.status,
      lastActivationTestAt: result.testedAt,
      lastActivationTestedBy: result.testedBy,
      activationEvidenceReference: sanitizeActivationEvidenceReference(
        result.evidenceReference,
      ),
      rowVersion: existing.rowVersion + 1,
      updatedAt: input.now.toISOString(),
    };
    this.records.set(input.gateKey, updated);
    return Promise.resolve(evaluateExternalGate(updated, input.now));
  }

  public setEmergencyState(
    input: Parameters<ExternalGateService["setEmergencyState"]>[0],
  ): Promise<ExternalGateView> {
    const existing = this.records.get(input.gateKey);
    if (!existing) return Promise.reject(new Error("EXTERNAL_GATE_NOT_FOUND"));
    if (existing.rowVersion !== input.expectedRowVersion)
      return Promise.reject(new Error("EXTERNAL_GATE_VERSION_CONFLICT"));
    const evidenceReference = sanitizeActivationEvidenceReference(
      input.evidenceReference,
    );
    const updated: ExternalGateRecord = {
      ...existing,
      emergencyDisabledAt: input.disabled ? input.now.toISOString() : null,
      emergencyDisabledBy: input.disabled ? input.actor.id : null,
      emergencyDisableReason: input.disabled ? input.reason.trim() : null,
      emergencyDisableEvidenceReference: input.disabled
        ? evidenceReference
        : null,
      rowVersion: existing.rowVersion + 1,
      updatedAt: input.now.toISOString(),
    };
    if (!input.disabled) assertExternalGateTransition(updated, input.now);
    this.records.set(input.gateKey, updated);
    return Promise.resolve(evaluateExternalGate(updated, input.now));
  }
}

function externalGateView(value: ExternalGateView) {
  return ExternalGateViewSchema.parse({
    ...value,
    emergencyDisabledAt: value.emergencyDisabledAt ?? null,
    emergencyDisabledBy: value.emergencyDisabledBy ?? null,
    emergencyDisableReason: value.emergencyDisableReason ?? null,
    emergencyDisableEvidenceReference:
      value.emergencyDisableEvidenceReference ?? null,
  });
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableInstant(value: Date | string | null): string | null {
  return value === null ? null : instant(value);
}

function exceptionRosterView(value: ExceptionRosterRecord) {
  return ExceptionRosterViewSchema.parse({
    ...value,
    qualifiedUntil: instant(value.qualifiedUntil),
    absentFrom: nullableInstant(value.absentFrom),
    absentUntil: nullableInstant(value.absentUntil),
    updatedAt: instant(value.updatedAt),
  });
}

const ExceptionCaseAssignmentViewSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    queue: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    status: z.string().min(1),
    ownerUserId: z.uuid(),
    backupUserId: z.uuid().nullable(),
    targetAt: z.iso.datetime({ offset: true }),
    rowVersion: z.number().int().positive(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

function exceptionCaseAssignmentView(value: ExceptionCaseAssignmentRecord) {
  return ExceptionCaseAssignmentViewSchema.parse({
    ...value,
    targetAt: instant(value.targetAt),
    updatedAt: instant(value.updatedAt),
  });
}

const listRoute = createRoute({
  method: "get",
  path: "/v1/system/external-gates",
  tags: ["system", "operations"],
  responses: {
    200: {
      description: "Internal external-gate activation register",
      content: {
        "application/json": {
          schema: z.object({ items: z.array(ExternalGateViewSchema) }),
        },
      },
    },
    403: { description: "Internal operator permission required" },
    503: { description: "Persistent external-gate service unavailable" },
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/v1/system/external-gates/{gateKey}",
  tags: ["system", "operations"],
  request: {
    params: z.object({ gateKey: GateKeySchema }),
    headers: z.object({ "idempotency-key": z.string().min(8) }),
    body: {
      required: true,
      content: { "application/json": { schema: ExternalGateUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: "External-gate status updated with activation policy",
      content: { "application/json": { schema: ExternalGateViewSchema } },
    },
    403: { description: "Operator permission or recent authentication failed" },
    404: { description: "Gate not found" },
    409: { description: "Optimistic row-version conflict" },
    422: { description: "Fail-closed activation policy denied the update" },
    503: { description: "Persistent external-gate service unavailable" },
  },
});

const activationTestRoute = createRoute({
  method: "post",
  path: "/v1/system/external-gates/{gateKey}/activation-tests",
  tags: ["system", "operations"],
  request: {
    params: z.object({ gateKey: GateKeySchema }),
    headers: z.object({ "idempotency-key": z.string().min(8) }),
    body: {
      required: true,
      content: { "application/json": { schema: ActivationTestRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Runner-derived external-gate activation test recorded",
      content: { "application/json": { schema: ExternalGateViewSchema } },
    },
    403: { description: "Operator permission or recent authentication failed" },
    404: { description: "Gate not found" },
    409: { description: "Optimistic row-version conflict" },
    503: { description: "Activation-test runner or persistence unavailable" },
  },
});

const emergencyStateRoute = createRoute({
  method: "put",
  path: "/v1/system/external-gates/{gateKey}/emergency-state",
  tags: ["system", "operations"],
  request: {
    params: z.object({ gateKey: GateKeySchema }),
    headers: z.object({ "idempotency-key": z.string().min(8) }),
    body: {
      required: true,
      content: { "application/json": { schema: EmergencyStateUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: "External gate emergency disable or restore recorded",
      content: { "application/json": { schema: ExternalGateViewSchema } },
    },
    403: { description: "Operator permission or recent authentication failed" },
    404: { description: "Gate not found" },
    409: { description: "Optimistic row-version conflict" },
    422: { description: "Emergency control policy denied the update" },
    503: { description: "Persistent external-gate service unavailable" },
  },
});

const activationTaskRoute = createRoute({
  method: "post",
  path: "/v1/system/external-gates/{gateKey}/activation-tasks",
  tags: ["system", "operations"],
  request: {
    params: z.object({ gateKey: GateKeySchema }),
    headers: z.object({ "idempotency-key": z.string().min(8) }),
    body: {
      required: true,
      content: { "application/json": { schema: ActivationTaskRequestSchema } },
    },
  },
  responses: {
    202: {
      description: "Durable external-gate activation task accepted",
      content: {
        "application/json": {
          schema: ExternalGateActivationTaskReceiptSchema,
        },
      },
    },
    403: { description: "Operator permission or recent authentication failed" },
    404: { description: "Gate not found" },
    409: { description: "Optimistic gate-version or idempotency conflict" },
    503: { description: "Durable activation scheduler unavailable" },
  },
});

const exceptionRosterRoute = createRoute({
  method: "put",
  path: "/v1/system/exception-roster/{rosterEntryId}",
  tags: ["system", "operations"],
  request: {
    params: z.object({ rosterEntryId: z.uuid() }),
    headers: z.object({ "idempotency-key": z.string().min(8) }),
    body: {
      required: true,
      content: { "application/json": { schema: ExceptionRosterUpsertSchema } },
    },
  },
  responses: {
    200: {
      description: "Existing exception-roster assignment updated",
      content: { "application/json": { schema: ExceptionRosterViewSchema } },
    },
    201: {
      description: "Exception-roster assignment created",
      content: { "application/json": { schema: ExceptionRosterViewSchema } },
    },
    403: { description: "Operator permission or recent authentication failed" },
    409: { description: "Optimistic row-version conflict" },
    422: { description: "Roster eligibility or assignment policy failed" },
    503: { description: "Persistent exception-roster service unavailable" },
  },
});

const exceptionCaseReassignmentRoute = createRoute({
  method: "post",
  path: "/v1/system/exception-cases/{caseId}/reassign",
  tags: ["system", "operations"],
  request: {
    params: z.object({ caseId: z.uuid() }),
    headers: z.object({ "idempotency-key": z.string().min(8) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              requestedBy: z.uuid(),
              reason: z.string().trim().min(8).max(2_000),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Open exception case reassigned from the persisted roster",
      content: {
        "application/json": { schema: ExceptionCaseAssignmentViewSchema },
      },
    },
    403: { description: "Operator permission or recent authentication failed" },
    404: { description: "Exception case not found" },
    409: { description: "Optimistic reassignment conflict" },
    422: { description: "Roster or open-case policy denied reassignment" },
    503: { description: "Persistent exception-roster service unavailable" },
  },
});

function unavailable(requestId: string): never {
  throw new ProblemError({
    type: "https://clockwork.test/problems/external-gate-service",
    title: "External-gate persistence is unavailable",
    status: 503,
    code: "EXTERNAL_GATE_SERVICE_UNAVAILABLE",
    requestId,
    retryable: true,
  });
}

function activationRunnerUnavailable(requestId: string): never {
  throw new ProblemError({
    type: "https://clockwork.test/problems/external-gate-activation-runner",
    title: "External-gate activation-test runner is unavailable",
    status: 503,
    code: "EXTERNAL_GATE_ACTIVATION_RUNNER_UNAVAILABLE",
    requestId,
    retryable: true,
  });
}

function administrationUnavailable(
  component: "activation-task-scheduler" | "exception-roster",
  requestId: string,
): never {
  throw new ProblemError({
    type: `https://clockwork.test/problems/${component}`,
    title:
      component === "activation-task-scheduler"
        ? "Durable activation-task scheduler is unavailable"
        : "Persistent exception-roster service is unavailable",
    status: 503,
    code:
      component === "activation-task-scheduler"
        ? "EXTERNAL_GATE_ACTIVATION_TASK_SERVICE_UNAVAILABLE"
        : "EXCEPTION_ROSTER_SERVICE_UNAVAILABLE",
    requestId,
    retryable: true,
  });
}

function mappedError(error: unknown, requestId: string): never {
  if (error instanceof ProblemError) throw error;
  const message = error instanceof Error ? error.message : "";
  const policy = error instanceof ExternalGatePolicyError;
  const notFound = [
    "EXTERNAL_GATE_NOT_FOUND",
    "EXCEPTION_CASE_NOT_FOUND",
  ].includes(message);
  const conflict =
    message.includes("VERSION_CONFLICT") ||
    message.includes("REASSIGNMENT_CONFLICT") ||
    message.includes("IDEMPOTENCY_CONFLICT");
  const forbidden = [
    "EXTERNAL_GATE_INTERNAL_OPERATOR_REQUIRED",
    "EXCEPTION_ROSTER_INTERNAL_OPERATOR_REQUIRED",
    "EXCEPTION_REASSIGNMENT_INTERNAL_OPERATOR_REQUIRED",
  ].includes(message);
  const invalidRoster =
    message.startsWith("EXCEPTION_ROSTER_") ||
    message.startsWith("EXCEPTION_ROUTING_") ||
    message === "EXCEPTION_NOT_OPEN";
  const invalidActivationTask = message.startsWith(
    "EXTERNAL_GATE_ACTIVATION_TASK_",
  );
  const status = notFound
    ? 404
    : conflict
      ? 409
      : forbidden
        ? 403
        : policy
          ? 422
          : invalidRoster
            ? 422
            : invalidActivationTask
              ? 422
              : 500;
  throw new ProblemError({
    type: "https://clockwork.test/problems/external-gate",
    title:
      status === 404
        ? "External gate not found"
        : status === 409
          ? "External gate version conflict"
          : status === 403
            ? "Internal operator authority required"
            : status === 422
              ? "System control policy denied the operation"
              : "External gate operation failed",
    status,
    code:
      status === 404
        ? "EXTERNAL_GATE_NOT_FOUND"
        : status === 409
          ? "VERSION_CONFLICT"
          : status === 403
            ? "INTERNAL_OPERATOR_REQUIRED"
            : policy
              ? error.code
              : status === 422
                ? message || "SYSTEM_CONTROL_POLICY_DENIED"
                : "EXTERNAL_GATE_OPERATION_FAILED",
    requestId,
    detail: policy ? error.message : undefined,
    retryable: false,
  });
}

export function registerExternalGateRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
  service: ExternalGateService | undefined,
  activationTestRunner: ActivationTestRunner | undefined,
  administration: ExternalGateAdministrationServices = {},
): void {
  app.openapi(listRoute, async (context) => {
    requirePermission(context, "system:operate");
    const request = context.get("requestContext");
    if (!service) unavailable(request.requestId);
    try {
      return context.json(
        {
          items: (
            await service.list({
              requestId: request.requestId,
              now: request.receivedAt,
            })
          ).map(externalGateView),
        },
        200,
      );
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
  app.openapi(updateRoute, async (context) => {
    const authorization = requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    if (!service) unavailable(request.requestId);
    try {
      return context.json(
        externalGateView(
          await service.update({
            ...context.req.valid("json"),
            gateKey: context.req.valid("param").gateKey,
            actor: authorizationActor(authorization),
            requestId: request.requestId,
            now: request.receivedAt,
          }),
        ),
        200,
      );
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
  app.openapi(activationTestRoute, async (context) => {
    const authorization = requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    if (!service) unavailable(request.requestId);
    if (!activationTestRunner) activationRunnerUnavailable(request.requestId);
    const gateKey = context.req.valid("param").gateKey;
    const expectedRowVersion = context.req.valid("json").expectedRowVersion;
    try {
      const gate = await service.get({
        gateKey,
        requestId: request.requestId,
        now: request.receivedAt,
      });
      if (gate.rowVersion !== expectedRowVersion)
        throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
      let rawResult: ExternalGateActivationTestResult;
      try {
        rawResult = await activationTestRunner.run({
          gate,
          actor: authorizationActor(authorization),
          requestId: request.requestId,
          requestedAt: request.receivedAt,
        });
      } catch {
        return activationRunnerUnavailable(request.requestId);
      }
      let result: ExternalGateActivationTestResult;
      try {
        const parsed = ActivationTestResultSchema.parse(rawResult);
        result = {
          ...parsed,
          evidenceReference: sanitizeActivationEvidenceReference(
            parsed.evidenceReference,
          ),
        };
      } catch {
        return activationRunnerUnavailable(request.requestId);
      }
      return context.json(
        externalGateView(
          await service.recordActivationTest({
            gateKey,
            expectedRowVersion,
            result,
            actor: authorizationActor(authorization),
            requestId: request.requestId,
            now: request.receivedAt,
          }),
        ),
        200,
      );
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
  app.openapi(emergencyStateRoute, async (context) => {
    const authorization = requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    if (!service) unavailable(request.requestId);
    try {
      return context.json(
        externalGateView(
          await service.setEmergencyState({
            ...context.req.valid("json"),
            gateKey: context.req.valid("param").gateKey,
            actor: authorizationActor(authorization),
            requestId: request.requestId,
            now: request.receivedAt,
          }),
        ),
        200,
      );
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
  app.openapi(activationTaskRoute, async (context) => {
    const authorization = requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    if (!service) unavailable(request.requestId);
    const scheduler = administration.activationTasks;
    if (!scheduler)
      administrationUnavailable("activation-task-scheduler", request.requestId);
    const gateKey = context.req.valid("param").gateKey;
    const input = context.req.valid("json");
    try {
      const gate = await service.get({
        gateKey,
        requestId: request.requestId,
        now: request.receivedAt,
      });
      if (gate.rowVersion !== input.expectedRowVersion)
        throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
      if (
        !input.taskKey.startsWith(`external-gate:${gateKey}:${input.provider}:`)
      )
        throw new Error("EXTERNAL_GATE_ACTIVATION_TASK_SCOPE_INVALID");
      return context.json(
        ExternalGateActivationTaskReceiptSchema.parse(
          await scheduler.enqueue({
            gateKey,
            expectedGateRowVersion: input.expectedRowVersion,
            taskKey: input.taskKey,
            provider: input.provider,
            idempotencyKey: context.req.valid("header")["idempotency-key"],
            actor: authorizationActor(authorization),
            requestId: request.requestId,
            now: request.receivedAt,
          }),
        ),
        202,
      );
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
  app.openapi(exceptionRosterRoute, async (context) => {
    const authorization = requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    const roster = administration.exceptionRoster;
    if (!roster)
      administrationUnavailable("exception-roster", request.requestId);
    const input = context.req.valid("json");
    try {
      const view = exceptionRosterView(
        await roster.upsert({
          ...input,
          rosterEntryId: context.req.valid("param").rosterEntryId,
          qualifiedUntil: new Date(input.qualifiedUntil),
          absentFrom: input.absentFrom ? new Date(input.absentFrom) : null,
          absentUntil: input.absentUntil ? new Date(input.absentUntil) : null,
          actor: authorizationActor(authorization),
          requestId: request.requestId,
          now: request.receivedAt,
        }),
      );
      return input.expectedRowVersion === 0
        ? context.json(view, 201)
        : context.json(view, 200);
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
  app.openapi(exceptionCaseReassignmentRoute, async (context) => {
    const authorization = requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    const roster = administration.exceptionRoster;
    if (!roster)
      administrationUnavailable("exception-roster", request.requestId);
    try {
      return context.json(
        exceptionCaseAssignmentView(
          await roster.reassignOpenCase({
            caseId: context.req.valid("param").caseId,
            ...context.req.valid("json"),
            actor: authorizationActor(authorization),
            requestId: request.requestId,
            now: request.receivedAt,
          }),
        ),
        200,
      );
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
}
