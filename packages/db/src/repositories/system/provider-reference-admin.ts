import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@clockwork/contracts";
import { sanitizeActivationEvidenceReference } from "@clockwork/domain/system";
import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { commerceUsers, memberships } from "../../schema";
import { systemProductionBootstraps } from "../../schema/system";
import { providerConnectionReferences } from "../../schema/system/provider-references";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

export const managedProviders = [
  "billing",
  "accounting",
  "notifications",
  "usage",
  "workos",
  "evidence",
  "provisioning",
  "screening",
  "signature",
  "tax",
  "crm",
  "document_renderer",
] as const;
export const ProviderReferenceFieldsSchema = z
  .object({
    provider: z.enum(managedProviders),
    secretReference: z
      .string()
      .trim()
      .max(1000)
      .regex(
        /^(?:secret|vault|arn):[A-Za-z0-9_./:-]+$/,
        "Use a secret-manager path, never a credential value or URL",
      ),
    secretVersion: z.string().trim().min(1).max(200),
    rotatedAt: z.iso.datetime({ offset: true }),
    owner: z.string().trim().min(1).max(200),
    reviewIntervalDays: z.number().int().min(1).max(730),
    sourceEvidence: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .transform((value, context) => {
        try {
          return sanitizeActivationEvidenceReference(value);
        } catch {
          context.addIssue({
            code: "custom",
            message: "Use a safe absolute evidence reference",
          });
          return z.NEVER;
        }
      }),
  })
  .strict();
export const ProviderReferenceCommandSchema =
  ProviderReferenceFieldsSchema.extend({
    expectedRowVersion: z.number().int().min(0).max(2147483646),
    reason: z.string().trim().min(8).max(2000),
  }).strict();
export type ProviderReferenceRow = {
  provider: (typeof managedProviders)[number];
  rowVersion: number;
  source: "registry" | "bootstrap" | "unconfigured";
  configuration: z.output<typeof ProviderReferenceFieldsSchema> | null;
  updatedAt: string | null;
  reviewDueAt: string | null;
};

async function requireAuthority(tx: RuntimeTransaction, actor: Actor) {
  if (
    actor.kind !== "user" ||
    actor.effectiveUserId ||
    actor.impersonatedAccountId
  )
    throw new Error("PROVIDER_REFERENCE_AUTHORITY_REQUIRED");
  const [staff] = await tx
    .select({ id: commerceUsers.id })
    .from(commerceUsers)
    .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
    .where(
      and(
        eq(commerceUsers.id, actor.id),
        eq(commerceUsers.isInternalStaff, true),
        eq(commerceUsers.mfaEnrolled, true),
        inArray(memberships.role, ["internal_operator", "finance_approver"]),
      ),
    )
    .limit(1)
    .for("share");
  if (!staff) throw new Error("PROVIDER_REFERENCE_AUTHORITY_REQUIRED");
  return staff.id;
}
export class DatabaseProviderReferenceAdmin {
  constructor(private readonly db: RuntimeDatabase) {}
  list(input: {
    actor: Actor;
    requestId: string;
  }): Promise<ProviderReferenceRow[]> {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      await requireAuthority(tx, input.actor);
      const rows = await tx.select().from(providerConnectionReferences);
      const [bootstrap] = await tx
        .select({ manifest: systemProductionBootstraps.manifest })
        .from(systemProductionBootstraps)
        .orderBy(desc(systemProductionBootstraps.appliedAt))
        .limit(1);
      const manifest = z
        .object({ providerReferences: z.array(z.unknown()) })
        .safeParse(bootstrap?.manifest);
      const initial = manifest.success
        ? manifest.data.providerReferences.flatMap((reference) => {
            const value = ProviderReferenceFieldsSchema.safeParse({
              ...(typeof reference === "object" && reference !== null
                ? reference
                : {}),
              owner: "Unassigned — set an operating owner",
              reviewIntervalDays: 90,
            });
            return value.success ? [value.data] : [];
          })
        : [];
      return managedProviders.map((provider) => {
        const row = rows.find((candidate) => candidate.provider === provider);
        const configuration = row
          ? ProviderReferenceFieldsSchema.parse({
              provider,
              secretReference: row.secretReference,
              secretVersion: row.secretVersion,
              rotatedAt: row.rotatedAt.toISOString(),
              owner: row.owner,
              reviewIntervalDays: row.reviewIntervalDays,
              sourceEvidence: row.sourceEvidence,
            })
          : (initial.find((candidate) => candidate.provider === provider) ??
            null);
        return {
          provider,
          configuration,
          rowVersion: row?.rowVersion ?? 0,
          source: row
            ? "registry"
            : configuration
              ? "bootstrap"
              : "unconfigured",
          updatedAt: row?.updatedAt.toISOString() ?? null,
          reviewDueAt: configuration
            ? new Date(
                Date.parse(configuration.rotatedAt) +
                  configuration.reviewIntervalDays * 86400000,
              ).toISOString()
            : null,
        };
      });
    });
  }
  save(input: {
    command: z.input<typeof ProviderReferenceCommandSchema>;
    actor: Actor;
    requestId: string;
  }) {
    const { expectedRowVersion, reason, ...configuration } =
      ProviderReferenceCommandSchema.parse(input.command);
    if (Date.parse(configuration.rotatedAt) > Date.now())
      throw new Error("PROVIDER_REFERENCE_FUTURE_ROTATION");
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const updatedBy = await requireAuthority(tx, input.actor);
      // Serialize first insert and edits using a stable provider key, including absent rows.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`provider-reference:${configuration.provider}`}, 0))`,
      );
      const [before] = await tx
        .select()
        .from(providerConnectionReferences)
        .where(
          eq(providerConnectionReferences.provider, configuration.provider),
        )
        .for("update");
      if ((before?.rowVersion ?? 0) !== expectedRowVersion)
        throw new Error("PROVIDER_REFERENCE_VERSION_CONFLICT");
      const rowVersion = expectedRowVersion + 1;
      const values = {
        ...configuration,
        rotatedAt: new Date(configuration.rotatedAt),
        rowVersion,
        updatedBy,
        updatedAt: new Date(),
      };
      const [after] = before
        ? await tx
            .update(providerConnectionReferences)
            .set(values)
            .where(eq(providerConnectionReferences.id, before.id))
            .returning()
        : await tx
            .insert(providerConnectionReferences)
            .values(values)
            .returning();
      if (!after) throw new Error("PROVIDER_REFERENCE_SAVE_FAILED");
      await appendAuditAndOutbox(tx, {
        aggregateType: "provider_configuration",
        aggregateId: after.id,
        aggregateVersion: rowVersion,
        eventType: "system.provider_reference.updated",
        actor: input.actor,
        requestId: input.requestId,
        before: before ?? {},
        after,
        metadata: { reason, attestationOnly: true },
      });
      return after.id;
    });
  }
}
