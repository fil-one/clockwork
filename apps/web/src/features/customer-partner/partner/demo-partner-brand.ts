import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, uuidV7 } from "@clockwork/contracts";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { z } from "zod";

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

import type { PartnerRecord } from "./partner-data";

const brandPrefix = "demo-partner-brand:";
const receiptPrefix = "demo-partner-brand-receipt:";

const bodySchema = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u),
    verificationToken: z.string().trim().min(8).max(512),
    brandName: z.string().trim().min(2).max(120),
    logoUrl: z.url().nullable(),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
    communicationOwner: z.enum(["fil_one", "partner"]),
  })
  .strict();

interface StoredBrand {
  readonly kind: "demo_partner_brand";
  readonly accountId: string;
  readonly record: PartnerRecord;
  readonly updatedAt: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

interface StoredReceipt {
  readonly kind: "demo_partner_brand_receipt";
  readonly requestHash: string;
  readonly response: Readonly<Record<string, unknown>>;
}

class BrandProblem extends Error {
  public constructor(
    public readonly status: 403 | 409 | 422,
    public readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStoredBrand(value: unknown): value is StoredBrand {
  return (
    isRecord(value) &&
    value.kind === "demo_partner_brand" &&
    typeof value.accountId === "string" &&
    typeof value.updatedAt === "string" &&
    isRecord(value.record) &&
    typeof value.record.id === "string" &&
    isRecord(value.settings)
  );
}

function isStoredReceipt(value: unknown): value is StoredReceipt {
  return (
    isRecord(value) &&
    value.kind === "demo_partner_brand_receipt" &&
    typeof value.requestHash === "string" &&
    isRecord(value.response)
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function demoPartnerBrandRecords(
  state: DemoAdapterState,
  accountId: string,
): readonly PartnerRecord[] {
  return Object.entries(state.projectionOverrides)
    .filter(([key]) => key.startsWith(brandPrefix))
    .map(([, override]): unknown => override.data)
    .filter(isStoredBrand)
    .filter((brand) => brand.accountId === accountId)
    .toSorted((left, right) =>
      left.updatedAt < right.updatedAt
        ? 1
        : left.updatedAt > right.updatedAt
          ? -1
          : 0,
    )
    .map((brand) => brand.record);
}

function problem(requestId: string, error: unknown): Response {
  const known = error instanceof BrandProblem;
  const validation =
    error instanceof z.ZodError || error instanceof SyntaxError;
  const status = known ? error.status : validation ? 422 : 500;
  const code = known
    ? error.code
    : validation
      ? "VALIDATION_FAILED"
      : "DEMO_PARTNER_BRAND_FAILED";
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: "Brand settings refused",
      status,
      detail:
        known || validation
          ? error instanceof Error
            ? error.message
            : "The brand settings are invalid"
          : "The demo could not record the brand settings.",
      code,
      requestId,
      retryable: status >= 500,
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function handleDemoPartnerBrand(
  request: Request,
  session: SessionClaims,
  accountId: string,
  input: { readonly store?: DemoAdapterStateStore; readonly now?: string } = {},
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    if (
      session.isInternalStaff ||
      !session.accountIds.includes(accountId) ||
      !session.roles.some((role) => hasPermission(role, "account:write")) ||
      !session.roles.some(
        (role) => role === "partner_admin" || role === "partner_seller",
      )
    )
      throw new BrandProblem(
        403,
        "PARTNER_BRAND_AUTHORITY_FORBIDDEN",
        "Partner account administration authority is required",
      );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 255
    )
      throw new BrandProblem(
        422,
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid idempotency-key header is required",
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    const requestHash = createHash("sha256")
      .update(request.method)
      .update("\0")
      .update(new URL(request.url).pathname)
      .update("\0")
      .update(bytes)
      .digest("hex");
    const settings = bodySchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const now = input.now ?? new Date().toISOString();
    const response = {
      accountId,
      domain: settings.domain,
      status: "pending",
      verification: "dns_required",
      updatedAt: now,
    } as const;
    let result: Readonly<Record<string, unknown>> = response;
    let replayed = false;
    await (input.store ?? configuredDemoStateStore()).update((state) => {
      const receiptKey = `${receiptPrefix}${digest(idempotencyKey)}`;
      const prior = state.projectionOverrides[receiptKey]?.data;
      if (isStoredReceipt(prior)) {
        if (prior.requestHash !== requestHash)
          throw new BrandProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to other brand settings",
          );
        replayed = true;
        result = prior.response;
        return state;
      }
      const record: PartnerRecord = {
        id: `DNS-${digest(settings.domain).slice(0, 8).toUpperCase()}`,
        name: settings.brandName,
        context: `${settings.domain} · ${settings.communicationOwner === "partner" ? "partner" : "Fil One"} communications`,
        status: "pending",
        risk: "medium",
        owner: "Partner admin",
        value: "DNS verification requested",
        secondary: "Add the verification record at your DNS provider",
      };
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [`${brandPrefix}${accountId}:${digest(settings.domain)}`]: {
            version: 1,
            updatedAt: now,
            data: {
              kind: "demo_partner_brand",
              accountId,
              record,
              updatedAt: now,
              settings: {
                domain: settings.domain,
                brandName: settings.brandName,
                logoUrl: settings.logoUrl,
                primaryColor: settings.primaryColor,
                communicationOwner: settings.communicationOwner,
                verificationTokenHash: digest(settings.verificationToken),
              },
            },
          },
          [receiptKey]: {
            version: 1,
            updatedAt: now,
            data: {
              kind: "demo_partner_brand_receipt",
              requestHash,
              response,
            },
          },
        },
      };
    });
    return Response.json(result, {
      headers: {
        "cache-control": "private, no-store",
        "idempotency-replayed": String(replayed),
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return problem(requestId, error);
  }
}
