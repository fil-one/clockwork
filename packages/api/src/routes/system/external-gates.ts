import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { ProblemError } from "@clockwork/contracts";
import { authorizationActor } from "@clockwork/domain";
import {
  assertExternalGateTransition,
  evaluateExternalGate,
  externalGateActivationTestIsCurrent,
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
}

export class MemoryExternalGateService implements ExternalGateService {
  private readonly records = new Map<string, ExternalGateRecord>();

  public constructor(records: readonly ExternalGateRecord[] = []) {
    for (const record of records) this.records.set(record.gateKey, record);
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

function mappedError(error: unknown, requestId: string): never {
  if (error instanceof ProblemError) throw error;
  const message = error instanceof Error ? error.message : "";
  const policy = error instanceof ExternalGatePolicyError;
  const status =
    message === "EXTERNAL_GATE_NOT_FOUND"
      ? 404
      : message === "EXTERNAL_GATE_VERSION_CONFLICT"
        ? 409
        : policy
          ? 422
          : 500;
  throw new ProblemError({
    type: "https://clockwork.test/problems/external-gate",
    title:
      status === 404
        ? "External gate not found"
        : status === 409
          ? "External gate version conflict"
          : status === 422
            ? "External gate activation denied"
            : "External gate operation failed",
    status,
    code:
      status === 404
        ? "EXTERNAL_GATE_NOT_FOUND"
        : status === 409
          ? "VERSION_CONFLICT"
          : policy
            ? error.code
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
): void {
  app.openapi(listRoute, async (context) => {
    requirePermission(context, "system:operate");
    const request = context.get("requestContext");
    if (!service) unavailable(request.requestId);
    try {
      return context.json(
        {
          items: await service.list({
            requestId: request.requestId,
            now: request.receivedAt,
          }),
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
        await service.update({
          ...context.req.valid("json"),
          gateKey: context.req.valid("param").gateKey,
          actor: authorizationActor(authorization),
          requestId: request.requestId,
          now: request.receivedAt,
        }),
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
        await service.recordActivationTest({
          gateKey,
          expectedRowVersion,
          result,
          actor: authorizationActor(authorization),
          requestId: request.requestId,
          now: request.receivedAt,
        }),
        200,
      );
    } catch (error) {
      return mappedError(error, request.requestId);
    }
  });
}
