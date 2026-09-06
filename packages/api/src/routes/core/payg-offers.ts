import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { ProblemError, type Actor } from "@clockwork/contracts";
import { authorizationActor, unscopedInternalOnly } from "@clockwork/domain";
import {
  PaygOfferCommandSchema,
  PaygOfferRecordSchema,
  PaygOfferTermsSchema,
  ratePaygPeriod,
  type PaygMeasurement,
  type PaygOfferCommand,
  type PaygOfferRecord,
} from "@clockwork/domain/core";

import {
  requirePermission,
  requireRecentAuthentication,
} from "../../auth/authorize";
import type { ApiVariables } from "../../context";

export const PaygEnrollmentCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("enroll"),
      id: z.uuid(),
      offerVersionId: z.uuid(),
      binding: z
        .object({
          mappingVersionId: z.string().min(1),
          accountId: z.uuid(),
          filOneOrganizationId: z.string().min(1),
          tenantId: z.string().min(1),
          entitlementId: z.string().min(1),
          sku: z.string().min(1),
          region: z.string().min(1),
          source: z.string().min(1),
          meters: z.tuple([
            z.literal("storage_bytes"),
            z.literal("egress_bytes"),
            z.literal("api_operations"),
          ]),
          status: z.literal("active"),
        })
        .strict(),
      bindingEvidenceId: z.string().min(1),
      startsAt: z.iso.datetime(),
      billingAuthority: z.enum(["fil_one", "clockwork"]),
      cutoverEvidenceId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel"),
      enrollmentId: z.uuid(),
      serviceEndsAt: z.iso.datetime(),
      evidenceId: z.string().min(1),
    })
    .strict(),
]);
export type PaygEnrollmentCommand = z.infer<typeof PaygEnrollmentCommandSchema>;
export const TrialAdministrationCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("claim"),
      id: z.uuid(),
      organizationId: z.uuid(),
      offerVersionId: z.uuid(),
      verificationEvidenceId: z
        .string()
        .regex(/^(dns|registration):[0-9a-f-]{36}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("convert"),
      trialId: z.uuid(),
      entitlementId: z.uuid().optional(),
      paygEnrollmentId: z.uuid().optional(),
    })
    .strict()
    .refine(
      (value) =>
        Boolean(value.entitlementId) !== Boolean(value.paygEnrollmentId),
      "One paid binding is required",
    ),
]);
export type TrialAdministrationCommand = z.infer<
  typeof TrialAdministrationCommandSchema
>;
export interface PaygOfferAdministrationService {
  list: () => Promise<PaygOfferRecord[]>;
  listTrials?: () => Promise<unknown[]>;
  trialCommand?: (input: {
    command: TrialAdministrationCommand;
    actor: Actor;
    now: string;
  }) => Promise<unknown>;
  listEnrollments?: () => Promise<unknown[]>;
  enrollmentCommand?: (input: {
    command: PaygEnrollmentCommand;
    actor: Actor;
    now: string;
  }) => Promise<unknown>;
  listPending?: () => Promise<
    readonly {
      idempotencyKey: string;
      kind: string;
      enrollmentId: string;
      accountId: string;
      month: string;
      revision: number;
      amount: { currency: string; minor: string };
    }[]
  >;
  materialize?: (input: {
    effectKey: string;
    actor: Actor;
    requestId: string;
    now: string;
  }) => Promise<{
    invoiceId: string;
    creditNoteIds?: string[];
    replay: boolean;
  }>;
  command: (input: {
    command: PaygOfferCommand;
    actor: Actor;
    requestId: string;
    now: string;
  }) => Promise<PaygOfferRecord>;
}
const listRoute = createRoute({
  method: "get",
  path: "/v1/core/payg-offers",
  tags: ["core", "pricing"],
  responses: {
    200: {
      description:
        "Persisted PAYG/trial policy versions; approval alone does not enable sales",
      content: {
        "application/json": {
          schema: z.object({ offers: z.array(PaygOfferRecordSchema) }),
        },
      },
    },
    403: { description: "Internal finance access required" },
    503: { description: "Policy service unavailable" },
  },
});
const commandRoute = createRoute({
  method: "post",
  path: "/v1/core/payg-offers",
  tags: ["core", "pricing"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: PaygOfferCommandSchema } },
    },
  },
  responses: {
    200: {
      description: "Saved policy version with audited decision",
      content: { "application/json": { schema: PaygOfferRecordSchema } },
    },
    403: {
      description: "Internal finance access and recent authentication required",
    },
    409: {
      description: "Policy state, version, or distinct approver conflict",
    },
    503: { description: "Policy service unavailable" },
  },
});

const simulateRoute = createRoute({
  method: "post",
  path: "/v1/core/payg-offers/simulate",
  tags: ["core", "pricing"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              terms: PaygOfferTermsSchema,
              month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
              averageStorageBytes: z
                .string()
                .regex(/^(0|[1-9]\d*)$/)
                .max(38),
              egressBytes: z
                .string()
                .regex(/^(0|[1-9]\d*)$/)
                .max(38),
              apiOperations: z
                .string()
                .regex(/^(0|[1-9]\d*)$/)
                .max(38),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Monthly policy simulation with no enrollment or billing effect",
      content: {
        "application/json": {
          schema: z.object({
            simulation: z.literal(true),
            month: z.string(),
            total: z.object({ currency: z.string(), minor: z.string() }),
            lines: z.array(
              z.object({
                kind: z.string(),
                amount: z.object({ currency: z.string(), minor: z.string() }),
                serviceStartsAt: z.string(),
                serviceEndsAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    403: { description: "Internal finance permission required" },
  },
});

const trialsRoute = createRoute({
  method: "get",
  path: "/v1/core/payg-offers/trials",
  tags: ["core", "trials"],
  responses: {
    200: {
      description: "Retained lifetime trial claims",
      content: {
        "application/json": {
          schema: z.object({ trials: z.array(z.unknown()) }),
        },
      },
    },
    403: { description: "Finance access required" },
    503: { description: "Trial service unavailable" },
  },
});
const trialCommandRoute = createRoute({
  method: "post",
  path: "/v1/core/payg-offers/trials",
  tags: ["core", "trials"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: TrialAdministrationCommandSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Verified trial claim or confirmed paid conversion",
      content: {
        "application/json": { schema: z.object({ trial: z.unknown() }) },
      },
    },
    403: { description: "Finance access required" },
    409: { description: "Trial eligibility or evidence conflict" },
    503: { description: "Trial service unavailable" },
  },
});

const enrollmentsRoute = createRoute({
  method: "get",
  path: "/v1/core/payg-offers/enrollments",
  tags: ["core", "billing"],
  responses: {
    200: {
      description: "Retained PAYG enrollments",
      content: {
        "application/json": {
          schema: z.object({ enrollments: z.array(z.unknown()) }),
        },
      },
    },
    403: { description: "Finance access required" },
    503: { description: "Billing unavailable" },
  },
});
const enrollmentCommandRoute = createRoute({
  method: "post",
  path: "/v1/core/payg-offers/enrollments",
  tags: ["core", "billing"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: PaygEnrollmentCommandSchema } },
    },
  },
  responses: {
    200: {
      description: "Verified enrollment or confirmed cancellation retained",
      content: {
        "application/json": { schema: z.object({ enrollment: z.unknown() }) },
      },
    },
    403: { description: "Finance access required" },
    409: { description: "Verified evidence required" },
    503: { description: "Billing unavailable" },
  },
});

const pendingRoute = createRoute({
  method: "get",
  path: "/v1/core/payg-offers/billing-effects",
  tags: ["core", "billing"],
  responses: {
    200: {
      description: "Retained billing deltas awaiting financial materialization",
      content: {
        "application/json": {
          schema: z.object({
            effects: z.array(
              z.object({
                idempotencyKey: z.string(),
                kind: z.string(),
                enrollmentId: z.string(),
                accountId: z.string(),
                month: z.string(),
                revision: z.number(),
                amount: z.object({ currency: z.string(), minor: z.string() }),
              }),
            ),
          }),
        },
      },
    },
    403: { description: "Finance access required" },
    503: { description: "Billing service unavailable" },
  },
});
const materializeRoute = createRoute({
  method: "post",
  path: "/v1/core/payg-offers/billing-effects",
  tags: ["core", "billing"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ effectKey: z.string().min(1).max(500) }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Invoice draft retained and queued for provider delivery",
      content: {
        "application/json": {
          schema: z.object({
            invoiceId: z.string(),
            creditNoteIds: z.array(z.string()).optional(),
            replay: z.boolean(),
          }),
        },
      },
    },
    403: { description: "Finance access required" },
    409: { description: "Source or tax evidence requires repair" },
    503: { description: "Billing service unavailable" },
  },
});

export function registerPaygOfferRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
  service?: PaygOfferAdministrationService,
): void {
  app.openapi(simulateRoute, (context) => {
    requirePermission(context, "billing:approve", unscopedInternalOnly);
    const input = context.req.valid("json");
    const start = new Date(`${input.month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const binding = {
      mappingVersionId: "simulation",
      accountId: "simulation",
      filOneOrganizationId: "simulation",
      tenantId: "simulation",
      entitlementId: "simulation",
      sku: input.terms.sku,
      region: input.terms.region,
      source: "simulation",
      meters: ["storage_bytes", "egress_bytes", "api_operations"] as const,
      status: "active" as const,
    };
    const measurements: PaygMeasurement[] = [];
    for (let hour = start.getTime(); hour < end.getTime(); hour += 3_600_000) {
      measurements.push({
        sourceMeasurementId: `simulation:${hour}`,
        source: "simulation",
        filOneOrganizationId: "simulation",
        tenantId: "simulation",
        entitlementId: "simulation",
        sku: input.terms.sku,
        region: input.terms.region,
        meter: "storage_bytes",
        startsAt: new Date(hour).toISOString(),
        endsAt: new Date(hour + 3_600_000).toISOString(),
        quantity: input.averageStorageBytes,
        recordedAt: end.toISOString(),
        kind: "usage",
      });
    }
    const first = measurements[0];
    if (!first) throw new Error("PAYG_SIMULATION_MONTH_INVALID");
    measurements.push(
      {
        ...first,
        sourceMeasurementId: "simulation:egress",
        meter: "egress_bytes",
        quantity: input.egressBytes,
      },
      {
        ...first,
        sourceMeasurementId: "simulation:api",
        meter: "api_operations",
        quantity: input.apiOperations,
      },
    );
    const rating = ratePaygPeriod({
      binding,
      policy: {
        ...input.terms.payg,
        currency: input.terms.payg.currency,
        id: "simulation",
        version: input.terms.version,
        approvalEvidenceId: "simulation-only-not-approval",
      },
      period: {
        month: input.month,
        serviceStartsAt: start.toISOString(),
        serviceEndsAt: end.toISOString(),
        final: false,
      },
      measurements,
      sourceClosedThrough: end.toISOString(),
      sourceCompleteCountMeters: ["egress_bytes", "api_operations"],
    });
    return context.json(
      {
        simulation: true as const,
        month: input.month,
        total: rating.total,
        lines: rating.lines,
      },
      200,
    );
  });
  const unavailable = (requestId: string) =>
    new ProblemError({
      type: "https://clockwork.test/problems/payg-offers",
      title: "PAYG policy service unavailable",
      status: 503,
      code: "PAYG_OFFERS_UNAVAILABLE",
      requestId,
      retryable: true,
    });
  app.openapi(trialsRoute, async (context) => {
    requirePermission(context, "billing:approve", unscopedInternalOnly);
    if (!service?.listTrials)
      throw unavailable(context.get("requestContext").requestId);
    return context.json({ trials: await service.listTrials() }, 200);
  });
  app.openapi(trialCommandRoute, async (context) => {
    const authorization = requirePermission(
      context,
      "billing:approve",
      unscopedInternalOnly,
    );
    requireRecentAuthentication(context);
    const requestId = context.get("requestContext").requestId;
    if (!service?.trialCommand) throw unavailable(requestId);
    try {
      return context.json(
        {
          trial: await service.trialCommand({
            command: context.req.valid("json"),
            actor: authorizationActor(authorization),
            now: new Date().toISOString(),
          }),
        },
        200,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.cause &&
        typeof error.cause === "object" &&
        "code" in error.cause &&
        error.cause.code === "23505"
      )
        throw new ProblemError({
          type: "https://clockwork.test/problems/trial",
          title: "Trial already claimed",
          status: 409,
          code: "TRIAL_ALREADY_USED",
          requestId,
          retryable: false,
        });
      if (error instanceof Error && error.message.startsWith("TRIAL_"))
        throw new ProblemError({
          type: "https://clockwork.test/problems/trial",
          title: "Trial evidence needs review",
          status: 409,
          code: error.message,
          requestId,
          retryable: false,
        });
      throw error;
    }
  });
  app.openapi(enrollmentsRoute, async (context) => {
    requirePermission(context, "billing:approve", unscopedInternalOnly);
    if (!service?.listEnrollments)
      throw unavailable(context.get("requestContext").requestId);
    return context.json({ enrollments: await service.listEnrollments() }, 200);
  });
  app.openapi(enrollmentCommandRoute, async (context) => {
    const authorization = requirePermission(
      context,
      "billing:approve",
      unscopedInternalOnly,
    );
    requireRecentAuthentication(context);
    const requestId = context.get("requestContext").requestId;
    if (!service?.enrollmentCommand) throw unavailable(requestId);
    try {
      return context.json(
        {
          enrollment: await service.enrollmentCommand({
            command: context.req.valid("json"),
            actor: authorizationActor(authorization),
            now: new Date().toISOString(),
          }),
        },
        200,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.cause &&
        typeof error.cause === "object" &&
        "code" in error.cause &&
        error.cause.code === "23505"
      )
        throw new ProblemError({
          type: "https://clockwork.test/problems/payg-enrollment",
          title: "Provider entitlement already enrolled",
          status: 409,
          code: "PAYG_ENROLLMENT_SOURCE_ALREADY_BOUND",
          requestId,
          retryable: false,
        });

      if (error instanceof Error && /^(PAYG_|TAX_)/.test(error.message))
        throw new ProblemError({
          type: "https://clockwork.test/problems/payg-enrollment",
          title: "Enrollment evidence needs review",
          status: 409,
          code: error.message,
          requestId,
          retryable: false,
        });
      throw error;
    }
  });
  app.openapi(pendingRoute, async (context) => {
    requirePermission(context, "billing:approve", unscopedInternalOnly);
    if (!service?.listPending)
      throw unavailable(context.get("requestContext").requestId);
    return context.json({ effects: [...(await service.listPending())] }, 200);
  });
  app.openapi(materializeRoute, async (context) => {
    const authorization = requirePermission(
      context,
      "billing:approve",
      unscopedInternalOnly,
    );
    requireRecentAuthentication(context);
    const requestId = context.get("requestContext").requestId;
    if (!service?.materialize) throw unavailable(requestId);
    try {
      return context.json(
        await service.materialize({
          effectKey: context.req.valid("json").effectKey,
          actor: authorizationActor(authorization),
          requestId,
          now: new Date().toISOString(),
        }),
        200,
      );
    } catch (error) {
      if (error instanceof Error && /^(PAYG_|TAX_)/.test(error.message))
        throw new ProblemError({
          type: "https://clockwork.test/problems/payg-billing",
          title: "Billing source needs review",
          status: 409,
          code: error.message,
          requestId,
          retryable: false,
        });
      throw error;
    }
  });
  app.openapi(listRoute, async (context) => {
    requirePermission(context, "billing:approve", unscopedInternalOnly);
    if (!service) throw unavailable(context.get("requestContext").requestId);
    return context.json({ offers: await service.list() }, 200);
  });
  app.openapi(commandRoute, async (context) => {
    const authorization = requirePermission(
      context,
      "billing:approve",
      unscopedInternalOnly,
    );
    requireRecentAuthentication(context);
    const requestId = context.get("requestContext").requestId;
    if (!service) throw unavailable(requestId);
    try {
      const record = await service.command({
        command: context.req.valid("json"),
        actor: authorizationActor(authorization),
        requestId,
        now: new Date().toISOString(),
      });
      return context.json(record, 200);
    } catch (error) {
      const databaseCode =
        error &&
        typeof error === "object" &&
        "cause" in error &&
        error.cause &&
        typeof error.cause === "object" &&
        "code" in error.cause
          ? error.cause.code
          : undefined;
      if (databaseCode === "23505")
        throw new ProblemError({
          type: "https://clockwork.test/problems/payg-policy",
          title: "This SKU, region, and offer version already exists",
          status: 409,
          code: "PAYG_OFFER_VERSION_EXISTS",
          requestId,
          retryable: false,
        });
      if (error instanceof Error && /^PAYG_OFFER_/.test(error.message))
        throw new ProblemError({
          type: "https://clockwork.test/problems/payg-policy",
          title: "PAYG policy change was not applied",
          status: 409,
          code: error.message,
          requestId,
          retryable: false,
        });
      throw error;
    }
  });
}
