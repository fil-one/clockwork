import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AddressSchema,
  ContactSchema,
  MoneySchema,
  uuidV7,
} from "@clockwork/contracts";
import { validatePriceBook } from "@clockwork/domain/core";
import { sanitizeActivationEvidenceReference } from "@clockwork/domain/system";
import { createDirectMigrationClient } from "./migration-client";

const reference = z
  .string()
  .min(1)
  .max(1000)
  .transform((value) => sanitizeActivationEvidenceReference(value));
const identity = z.string().regex(/^[a-z]+_[A-Za-z0-9]+$/);
const quantity = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);
const rateSchema = z
  .object({
    id: z.uuid(),
    sku: z.string().min(1).max(80),
    region: z.string().min(1).max(80),
    unit: z.string().min(1),
    approvedClaim: z.string().min(1),
    unitPrice: MoneySchema,
    floorPrice: MoneySchema,
    overageRate: MoneySchema,
    minimumQuantity: quantity,
    egressTreatment: z.string().min(1),
    commitType: z.enum(["period_allowance", "term_drawdown"]),
    stripeTaxCode: z.string().min(1),
    qboIncomeAccount: z.string().min(1),
    provisioning: z
      .object({
        providerSku: z.string().min(1),
        providerRegion: z.string().min(1),
        meterId: z.string().min(1),
        sourceEvidence: reference,
      })
      .strict(),
  })
  .strict();

export const ProductionBootstrapManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    environment: z.enum(["staging", "production"]),
    targetDatabaseHost: z.string().min(1),
    sourceEvidence: reference,
    operatorUserId: z.uuid(),
    identityVerificationAttestation: z.literal(
      "verified_with_identity_provider",
    ),
    account: z
      .object({
        id: z.uuid(),
        legalName: z.string().min(1),
        domain: z.string().min(3),
        country: z.string().regex(/^[A-Z]{2}$/),
        currency: z.enum(["USD", "EUR", "GBP"]),
        registeredAddress: AddressSchema,
        billingContact: ContactSchema,
        apContact: ContactSchema,
        invoiceDeliveryEmail: z.email(),
      })
      .strict(),
    organization: z
      .object({
        id: z.uuid(),
        name: z.string().min(1),
        workosOrganizationId: identity.refine((value) =>
          value.startsWith("org_"),
        ),
      })
      .strict(),
    staff: z
      .array(
        z
          .object({
            id: z.uuid(),
            workosUserId: identity.refine((value) => value.startsWith("user_")),
            email: z.email(),
            name: z.string().min(1),
            role: z.enum([
              "internal_operator",
              "finance_approver",
              "legal_approver",
              "destructive_action_approver",
            ]),
            mfaVerifiedAt: z.iso.datetime(),
            mfaEvidence: reference,
          })
          .strict(),
      )
      .min(2)
      .max(50),
    providerReferences: z
      .array(
        z
          .object({
            provider: z.enum([
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
            ]),
            secretReference: z.string().regex(/^(?:secret|vault|arn):[^\s]+$/),
            secretVersion: z.string().min(1).max(200),
            rotatedAt: z.iso.datetime(),
            sourceEvidence: reference,
          })
          .strict(),
      )
      .max(30),
    catalog: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().min(1),
            currency: z.enum(["USD", "EUR", "GBP"]),
            version: z.number().int().positive(),
            effectiveFrom: z.iso.date(),
            sourceEvidence: reference,
            rates: z.array(rateSchema).min(1).max(500),
          })
          .strict(),
      )
      .max(30),
    organizationMappings: z
      .array(
        z
          .object({
            provider: z.enum(["fil_one", "workos", "crm"]),
            providerOrganizationId: z.string().min(1).max(300),
            sourceEvidence: reference,
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type ProductionBootstrapManifest = z.infer<
  typeof ProductionBootstrapManifestSchema
>;

/** Shape only. `validateProductionBootstrap` adds the checks that depend on
 * the clock and on the manifest as a whole. */
export function parseProductionBootstrap(value: unknown) {
  return ProductionBootstrapManifestSchema.parse(value);
}

export function validateProductionBootstrap(value: unknown, now = new Date()) {
  const manifest = parseProductionBootstrap(value);
  const ids = manifest.staff.map((person) => person.id);
  const workosIds = manifest.staff.map((person) => person.workosUserId);
  const emails = manifest.staff.map((person) => person.email.toLowerCase());
  if (
    [ids, workosIds, emails].some(
      (values) => new Set(values).size !== values.length,
    )
  )
    throw new Error("BOOTSTRAP_DUPLICATE_STAFF_IDENTITY");
  if (
    !manifest.staff.some(
      (person) =>
        person.id === manifest.operatorUserId &&
        person.role === "internal_operator",
    ) ||
    !manifest.staff.some(
      (person) =>
        person.id !== manifest.operatorUserId &&
        person.role === "finance_approver",
    )
  )
    throw new Error("BOOTSTRAP_DISTINCT_OPERATOR_AND_FINANCE_REQUIRED");
  if (
    [manifest.account.domain, ...emails].some((value) =>
      /(?:\.test|\.example|localhost)$/i.test(value),
    )
  )
    throw new Error("BOOTSTRAP_FICTIONAL_IDENTITY_FORBIDDEN");
  for (const person of manifest.staff) {
    const age = now.getTime() - Date.parse(person.mfaVerifiedAt);
    if (!Number.isFinite(age) || age < 0 || age > 86_400_000)
      throw new Error("BOOTSTRAP_CURRENT_MFA_EVIDENCE_REQUIRED");
  }
  if (
    new Set(manifest.providerReferences.map((value) => value.provider)).size !==
    manifest.providerReferences.length
  )
    throw new Error("BOOTSTRAP_DUPLICATE_PROVIDER_REFERENCE");
  for (const provider of manifest.providerReferences)
    if (Date.parse(provider.rotatedAt) > now.getTime())
      throw new Error("BOOTSTRAP_FUTURE_ROTATION_FORBIDDEN");
  for (const book of manifest.catalog)
    validatePriceBook({
      id: book.id,
      name: book.name,
      currency: book.currency,
      version: book.version,
      effectiveFrom: book.effectiveFrom,
      status: "draft",
      rateCards: book.rates.map(({ provisioning: _mapping, ...rate }) => ({
        ...rate,
        partnerTransferPrices: {},
      })),
    });
  return manifest;
}

export function productionBootstrapDigest(
  manifest: ProductionBootstrapManifest,
): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function assertBootstrapTarget(
  manifest: ProductionBootstrapManifest,
  databaseUrl: string,
  expectedHost: string,
) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== manifest.targetDatabaseHost ||
    url.hostname !== expectedHost
  )
    throw new Error("BOOTSTRAP_TARGET_HOST_MISMATCH");
  if (
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
    manifest.environment === "production"
  )
    throw new Error("BOOTSTRAP_PRODUCTION_TARGET_REQUIRED");
}

/**
 * Explicit one-time owner operation. No seed, credentials, active commercial
 * claims, fake identities, or gate activation is supplied by this program.
 */
export async function applyProductionBootstrap(input: {
  manifest: ProductionBootstrapManifest;
  databaseUrl: string;
  expectedHost: string;
  authorizationSecret: string;
  /** An authorization-secret row a deployment wrote before it had a manifest.
   * Removed in the bootstrap's own transaction, so the register is never
   * empty at a commit; any other pre-existing row still refuses the apply. */
  retireSecretId?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  // Shape first, the time-bound checks inside the transaction: a manifest that
  // is already recorded is recognised and left alone before its MFA evidence
  // is judged, because every deploy re-applies the same manifest long after
  // that evidence has aged past the 24-hour window.
  const manifest = parseProductionBootstrap(input.manifest);
  assertBootstrapTarget(manifest, input.databaseUrl, input.expectedHost);
  if (
    input.authorizationSecret.length < 32 ||
    input.authorizationSecret.includes("clockwork-local")
  )
    throw new Error("BOOTSTRAP_PRODUCTION_AUTHORIZATION_SECRET_REQUIRED");
  const digest = productionBootstrapDigest(manifest);
  const client = createDirectMigrationClient(input.databaseUrl);
  try {
    return await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('clockwork-production-bootstrap'))`;
      const prior = await tx<
        { manifest_hash: string }[]
      >`select manifest_hash from public.system_production_bootstraps where id = ${manifest.id}`;
      if (prior[0]) {
        if (prior[0].manifest_hash !== digest)
          throw new Error("BOOTSTRAP_MANIFEST_CONFLICT");
        return { status: "already_applied" as const, id: manifest.id, digest };
      }
      validateProductionBootstrap(manifest, now);
      if (input.retireSecretId)
        await tx`delete from private.authorization_secrets where id = ${input.retireSecretId}`;
      const secrets =
        await tx`select id from private.authorization_secrets limit 1`;
      if (secrets.length)
        throw new Error(
          "BOOTSTRAP_REQUIRES_EMPTY_AUTHORIZATION_SECRET_REGISTER",
        );
      const populated =
        await tx`select id from public.accounts union all select id from public.commerce_users union all select id from public.price_books union all select id from public.system_provider_resource_bindings limit 1`;
      if (populated.length)
        throw new Error("BOOTSTRAP_REQUIRES_EMPTY_COMMERCE_DATABASE");
      const active =
        await tx`select capability_key from public.system_capabilities where enabled or recovery_enabled limit 1`;
      if (active.length)
        throw new Error("BOOTSTRAP_REQUIRES_DISABLED_CAPABILITIES");
      const a = manifest.account;
      await tx`insert into public.accounts (id, legal_name, relationship_roles, registered_address, billing_contact, ap_contact, invoice_delivery_email, domain, country, currency, screening_status)
        values (${a.id}, ${a.legalName}, array['direct_client'], ${tx.json(a.registeredAddress)}, ${tx.json(a.billingContact)}, ${tx.json(a.apContact)}, ${a.invoiceDeliveryEmail}, ${a.domain}, ${a.country}, ${a.currency}, 'pending')`;
      await tx`insert into public.organizations (id, account_id, name, isolated, workos_organization_id)
        values (${manifest.organization.id}, ${a.id}, ${manifest.organization.name}, true, ${manifest.organization.workosOrganizationId})`;
      for (const person of manifest.staff) {
        await tx`insert into public.commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
          values (${person.id}, ${person.workosUserId}, ${person.email}, ${person.name}, true, true)`;
        await tx`insert into public.memberships (id, organization_id, user_id, role)
          values (${uuidV7()}, ${manifest.organization.id}, ${person.id}, ${person.role})`;
      }
      // The secret is supplied separately from the reviewable manifest and is
      // never included in the receipt, audit payload, or diagnostic output.
      await tx`insert into private.authorization_secrets (id, secret, active) values (${`bootstrap:${manifest.id}`}, ${input.authorizationSecret}, true)`;
      for (const book of manifest.catalog) {
        await tx`insert into public.price_books (id, name, currency, version, effective_from, status)
          values (${book.id}, ${book.name}, ${book.currency}, ${book.version}, ${book.effectiveFrom}, 'draft')`;
        for (const rate of book.rates) {
          await tx`insert into public.rate_cards (id, price_book_id, sku, region, unit, approved_claim, unit_price_minor, floor_price_minor, overage_rate_minor, minimum_quantity, egress_treatment, commit_type, stripe_tax_code, qbo_income_account, partner_transfer_prices)
            values (${rate.id}, ${book.id}, ${rate.sku}, ${rate.region}, ${rate.unit}, ${rate.approvedClaim}, ${rate.unitPrice.minor}, ${rate.floorPrice.minor}, ${rate.overageRate.minor}, ${rate.minimumQuantity}, ${rate.egressTreatment}, ${rate.commitType}, ${rate.stripeTaxCode}, ${rate.qboIncomeAccount}, '{}'::jsonb)`;
          await tx`insert into public.system_provider_resource_bindings (provider, provider_resource_type, provider_resource_id, aggregate_type, aggregate_id, binding)
            values ('fil_one', 'sku_region', ${`${rate.provisioning.providerSku}:${rate.provisioning.providerRegion}:${rate.id}`}, 'rate_card', ${rate.id}, ${tx.json(rate.provisioning)})`;
        }
      }
      for (const mapping of manifest.organizationMappings)
        await tx`insert into public.system_provider_resource_bindings (provider, provider_resource_type, provider_resource_id, aggregate_type, aggregate_id, binding)
        values (${mapping.provider}, 'organization', ${mapping.providerOrganizationId}, 'organization', ${manifest.organization.id}, ${tx.json({ sourceEvidence: mapping.sourceEvidence, bootstrapId: manifest.id })})`;
      await tx`insert into public.system_production_bootstraps (id, manifest_hash, manifest, applied_by, applied_at)
        values (${manifest.id}, ${digest}, ${tx.json(manifest)}, ${manifest.operatorUserId}, ${now})`;
      const auditId = uuidV7();
      const actor = { kind: "user", id: manifest.operatorUserId };
      const data = {
        bootstrapId: manifest.id,
        manifestHash: digest,
        staffCount: manifest.staff.length,
        catalogDrafts: manifest.catalog.length,
        capabilitiesEnabled: false,
        identityVerification: "supplied_external_evidence_not_probed",
      };
      await tx`insert into public.audit_events (id, aggregate_type, aggregate_id, aggregate_version, event_type, event_version, actor, occurred_at, request_id, after, metadata)
        values (${auditId}, 'system_bootstrap', ${manifest.id}, 1, 'system.production_bootstrap.completed', 1, ${tx.json(actor)}, ${now}, ${`bootstrap:${manifest.id}`}, ${tx.json(data)}, '{}'::jsonb)`;
      await tx`insert into public.outbox_messages (id, event_id, topic, payload)
        values (${uuidV7()}, ${auditId}, 'system.production_bootstrap.completed', ${tx.json({ eventId: auditId, eventType: "system.production_bootstrap.completed", aggregateType: "system_bootstrap", aggregateId: manifest.id, aggregateVersion: 1, occurredAt: now.toISOString(), requestId: `bootstrap:${manifest.id}`, actor, data })})`;
      return { status: "applied" as const, id: manifest.id, digest };
    });
  } finally {
    await client.end();
  }
}
