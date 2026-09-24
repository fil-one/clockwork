import "server-only";
import { z } from "zod";
import type { SessionClaims } from "@clockwork/api";
import {
  PaygOfferCommandSchema,
  PaygOfferTermsSchema,
  ratePaygPeriod,
  type PaygMeasurement,
} from "@clockwork/domain/core";
import { localeCookie, resolveLocale, type Locale } from "@/src/i18n";

import {
  DemoCommercialPolicyRepository,
  localizeDemoPaygPolicy,
} from "./demo-policies";

/**
 * The reader's interface language, from the same cookie the pages read, so a
 * policy returned to the browser carries its demo-authored text in that
 * language (the stored record stays English).
 */
function requestLocale(request: Request): Locale {
  const prefix = `${localeCookie}=`;
  const value = (request.headers.get("cookie") ?? "")
    .split(/;\s*/u)
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return resolveLocale(value);
}
const quantity = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(38);
const simulationSchema = z
  .object({
    terms: PaygOfferTermsSchema,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    averageStorageBytes: quantity,
    egressBytes: quantity,
    apiOperations: quantity,
  })
  .strict();
export function simulateDemoPayg(body: unknown) {
  const input = simulationSchema.parse(body);
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
  return {
    simulation: true,
    month: input.month,
    total: rating.total,
    lines: rating.lines,
  };
}
export async function handleDemoPaygPolicy(
  request: Request,
  session: SessionClaims,
  repo = new DemoCommercialPolicyRepository(),
): Promise<Response> {
  if (
    session.impersonation ||
    !session.isInternalStaff ||
    !session.roles.includes("finance_approver") ||
    !session.mfaVerified ||
    !session.recentAuthenticationVerified
  )
    return Response.json(
      { code: "PAYG_OFFER_FINANCE_REQUIRED" },
      { status: 403 },
    );
  try {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/simulate") && request.method === "POST")
      return Response.json(simulateDemoPayg(await request.json()));
    if (path !== "/api/v1/core/payg-offers")
      return Response.json(
        { code: "DEMO_BILLING_EVIDENCE_UNAVAILABLE" },
        { status: 503 },
      );
    const locale = requestLocale(request);
    if (request.method === "GET")
      return Response.json({
        offers: (await repo.listPayg()).map((offer) =>
          localizeDemoPaygPolicy(offer, locale),
        ),
      });
    if (request.method !== "POST")
      return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405 });
    const requestId = request.headers.get("idempotency-key")?.trim();
    if (!requestId || requestId.length < 16 || requestId.length > 255)
      return Response.json(
        { code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 422 },
      );
    const command = PaygOfferCommandSchema.parse(await request.json());
    return Response.json(
      localizeDemoPaygPolicy(
        await repo.commandPayg({
          command,
          userId: session.userId,
          requestId,
          now: new Date().toISOString(),
        }),
        locale,
      ),
    );
  } catch (error) {
    return Response.json(
      {
        code:
          error instanceof z.ZodError
            ? "VALIDATION_ERROR"
            : error instanceof Error
              ? error.message
              : "DEMO_POLICY_FAILED",
      },
      { status: error instanceof z.ZodError ? 422 : 409 },
    );
  }
}
