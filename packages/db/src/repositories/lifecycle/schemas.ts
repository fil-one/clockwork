import { z } from "zod";

import { MarketplaceEventPayloadSchema } from "@clockwork/contracts";

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const accountId = uuid;
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export const registrationPayloadSchema = strict({
  legalName: z.string().trim().min(2),
  country: z.string().regex(/^[A-Z]{2}$/),
  registeredAddress: strict({
    line1: z.string().trim().min(1),
    line2: z.string().optional(),
    city: z.string().trim().min(1),
    region: z.string().optional(),
    postalCode: z.string().trim().min(1),
    country: z.string().regex(/^[A-Z]{2}$/),
  }),
  relationshipRoles: z
    .array(z.enum(["direct_client", "partner", "end_client"]))
    .min(1),
  businessDomain: z.string().trim().min(3),
  registrantEmail: z.email(),
  registrationToken: z.undefined().optional(),
  taxIds: z
    .array(
      strict({
        jurisdiction: z.string().regex(/^[A-Z]{2}$/),
        value: z.string().trim().min(3),
      }),
    )
    .max(20),
  billingContact: strict({ name: z.string(), email: z.email() }),
  apContact: strict({ name: z.string(), email: z.email() }).nullable(),
  invoiceDeliveryEmail: z.email(),
  workosUserId: z.string().trim().min(1),
  domainVerifiedAt: instant,
});

export const inviteMemberPayloadSchema = strict({
  accountId,
  organizationId: uuid,
  email: z.email(),
  role: z.enum([
    "owner",
    "admin",
    "billing",
    "member",
    "partner_admin",
    "partner_seller",
  ]),
  expiresAt: instant,
});

export const switchAccountPayloadSchema = strict({ accountId });

export const verifyPartnerDomainPayloadSchema = strict({
  accountId,
  domain: z.string().trim().min(3),
  verificationToken: z.string().min(16),
  brandName: z.string().trim().min(1),
  logoUrl: z.url().nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  communicationOwner: z.enum(["fil_one", "partner"]),
  verificationEvidence: strict({
    verifiedAt: instant,
    evidenceReference: z.string().trim().min(1).max(512),
  }),
});

export const updateProcurementPayloadSchema = strict({
  accountId,
  apContact: strict({ name: z.string(), email: z.email() }),
  invoiceDeliveryEmail: z.email(),
  poRequired: z.boolean(),
  exemptions: z.array(
    strict({
      jurisdiction: z.string().min(1),
      certificateDocumentId: uuid,
      expiresOn: date.nullable(),
    }),
  ),
  supplierDocuments: z.array(
    strict({ kind: z.string().min(1), documentId: uuid }),
  ),
  buyerPortalTasks: z.array(
    strict({
      taskId: z.string().min(1),
      ownerId: uuid,
      dueAt: instant,
      reminderEveryHours: z.number().int().positive(),
    }),
  ),
});

export const publishAgreementTemplatePayloadSchema = strict({
  type: z.string().trim().min(1),
  semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  jurisdiction: z.string().trim().min(2),
  effectiveOn: date,
  canonicalDocumentId: uuid,
  exactText: z.string().min(1),
  exactTextHash: sha256,
  executionMode: z.enum(["click_through", "counter_signed"]),
  approvalEvidenceDocumentId: uuid,
});

export const uploadCustomerPaperPayloadSchema = strict({
  accountId,
  uploadedDocumentId: uuid,
  negotiationStatus: z.enum(["received", "redlining", "agreed"]),
  jurisdiction: z.string().trim().min(2),
  keyTerms: z.record(z.string(), z.unknown()),
});

export const executeClickThroughPayloadSchema = strict({
  accountId,
  templateId: uuid,
  templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  exactText: z.string().min(1),
  exactTextHash: sha256,
  authorityTitle: z.string().trim().min(2),
  authorityAttested: z.literal(true),
  uiContext: strict({
    surface: z.string().trim().min(1),
    actionLabel: z.string().trim().min(1),
    locale: z.string().trim().min(2),
  }),
  previousAgreementId: uuid.nullable(),
});

export const createSignatureEnvelopePayloadSchema = strict({
  accountId,
  agreementId: uuid,
  documentId: uuid,
  signerEmail: z.email(),
  mode: z.enum(["redirect", "embedded"]),
  returnUrl: z.url(),
});

export const signatureEventPayloadSchema = strict({
  type: z.enum([
    "envelope.sent",
    "envelope.viewed",
    "envelope.completed",
    "envelope.declined",
    "envelope.expired",
    "envelope.voided",
  ]),
  eventId: z.string().trim().min(1),
  envelopeId: z.string().trim().min(1),
  sequence: z.number().int().positive(),
  occurredAt: instant,
  signedPdfDocumentId: uuid.optional(),
  completionCertificateDocumentId: uuid.optional(),
});

const pocSuccessSnapshotSchema = strict({
  snapshotId: z.string().trim().min(1),
  pocId: uuid,
  source: z.literal("poc_milestone_ledger"),
  evaluatedAt: instant,
  evaluatorId: z.string().trim().min(1),
  tests: z
    .array(
      strict({
        testId: z.string().trim().min(1),
        passed: z.boolean(),
        evidenceHash: sha256,
      }),
    )
    .min(1),
  evidenceHash: sha256,
});

export const provisioningEventPayloadSchema = z.discriminatedUnion("type", [
  strict({
    type: z.literal("provisioning.confirmed"),
    confirmationId: z.string().trim().min(1),
    commandId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    status: z.enum(["succeeded", "failed"]),
    tenantId: z.string().trim().min(1),
    resources: z.array(
      strict({
        entitlementSku: z.string().trim().min(1),
        resourceId: z.string().trim().min(1),
      }),
    ),
    excludedObjectIds: z.array(z.string().min(1)).optional(),
    deletedScope: z.array(z.string().trim().min(1)).min(1).optional(),
    deletionMethod: z.string().trim().min(1).optional(),
    occurredAt: instant,
  }),
  strict({
    type: z.literal("poc.success_recorded"),
    eventId: z.string().trim().min(1),
    snapshot: pocSuccessSnapshotSchema,
    occurredAt: instant,
  }),
]);

export const marketplaceEventPayloadSchema = MarketplaceEventPayloadSchema;

export const createPocPayloadSchema = strict({
  accountId,
  partnerAccountId: accountId.nullable(),
  workload: z.string().trim().min(8),
  buyerUserId: uuid,
  permittedDataClass: z.enum([
    "synthetic",
    "public",
    "confidential",
    "regulated",
  ]),
  successTests: z
    .array(
      strict({
        id: z.string().min(1),
        description: z.string().min(1),
        target: z.string().trim().min(1),
      }),
    )
    .min(1),
  capacityCap: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/),
  egressCap: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/),
  expiresAt: instant,
  supportOwnerId: uuid,
});

export const decidePocPayloadSchema = strict({
  pocId: uuid,
  accountId,
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(8),
  evidenceDocumentId: uuid,
});

export const convertPocPayloadSchema = strict({
  pocId: uuid,
  accountId,
  quoteId: uuid,
  orderId: uuid,
});

export const recoverProvisioningPayloadSchema = strict({
  commandId: z.string().trim().min(1),
  reason: z.string().trim().min(8),
});

export const acceptPassThroughPayloadSchema = strict({
  accountId,
  organizationId: uuid,
  templateId: uuid,
  templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  exactTextHash: sha256,
  uiContext: z.string().trim().min(1),
});

export const recordInboundNoticePayloadSchema = strict({
  accountId,
  orderId: uuid,
  type: z.enum(["non_renewal", "termination", "breach_claim", "other"]),
  servedOn: date,
  evidenceDocumentId: uuid,
  source: z.enum(["portal", "email", "mail", "esign"]),
});

export const renewalCommandCenterPayloadSchema = strict({
  accountId: accountId.optional(),
  window: z.enum(["30", "60_90", "180", "all"]),
  timeZone: z.string().trim().min(1),
});

export const requestRenewalPayloadSchema = strict({
  orderId: uuid,
  accountId,
  requestedAction: z.enum(["renew", "change_term", "request_change"]),
  requestedTermMonths: z.number().int().positive().nullable(),
});

export const declineRenewalPayloadSchema = strict({
  orderId: uuid,
  accountId,
  reason: z.string().trim().min(1),
  authorityTitle: z.string().trim().min(2),
  authorityAttested: z.literal(true),
  evidenceDocumentId: uuid,
});

export const requestTerminationPayloadSchema = strict({
  accountId,
  orderId: uuid,
  reason: z.enum([
    "customer_request",
    "non_renewal",
    "partner_request",
    "partner_default",
    "material_breach",
  ]),
  effectiveAt: instant,
  retrievalDays: z.number().int().positive(),
  partnerAccountId: accountId.nullable(),
});

export const decideTerminationPayloadSchema = strict({
  terminationId: uuid,
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(8),
  evidenceDocumentId: uuid,
});

export const createNovationPayloadSchema = strict({
  accountId,
  formerPartnerAccountId: accountId,
  sourceOrderId: uuid,
  newAgreementId: uuid,
  newOrderId: uuid,
  reason: z.enum(["partner_default", "partner_exit", "agreed_handoff"]),
});

export const openExceptionPayloadSchema = strict({
  accountId: accountId.nullable(),
  queue: z.enum([
    "pricing",
    "legal",
    "credit_collections",
    "restricted_parties",
    "disputes",
    "deal_registration_disputes",
    "poc_qualification",
  ]),
  objectType: z.string().trim().min(1),
  objectId: uuid,
  reason: z.string().trim().min(8),
  evidenceDocumentId: uuid,
});

export const decideExceptionPayloadSchema = strict({
  caseId: uuid,
  accountId: accountId.nullable(),
  queue: openExceptionPayloadSchema.shape.queue,
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(8),
  evidenceDocumentId: uuid,
});

export const listSupportSignalsPayloadSchema = strict({
  accountId,
  since: instant.optional(),
});

export const startMigrationPayloadSchema = strict({
  executionMode: z.enum(["discovery", "rehearsal", "execute"]),
  sourceSnapshotHash: sha256,
  resumeRunId: uuid.nullable(),
  batchSize: z.number().int().min(1).max(100),
});

export const decideMigrationMatchPayloadSchema = strict({
  runId: uuid,
  legacyAccountId: z.string().trim().min(1),
  decision: z.enum(["create", "attach", "skip"]),
  accountId: accountId.nullable(),
  reason: z.string().trim().min(8),
  evidenceDocumentId: uuid,
});

export const lifecyclePayloadSchemas = {
  register: registrationPayloadSchema,
  invite_member: inviteMemberPayloadSchema,
  switch_account: switchAccountPayloadSchema,
  verify_partner_domain: verifyPartnerDomainPayloadSchema,
  update_procurement: updateProcurementPayloadSchema,
  publish_agreement_template: publishAgreementTemplatePayloadSchema,
  upload_customer_paper: uploadCustomerPaperPayloadSchema,
  execute_click_through: executeClickThroughPayloadSchema,
  create_signature_envelope: createSignatureEnvelopePayloadSchema,
  ingest_signature_event: signatureEventPayloadSchema,
  ingest_provisioning_event: provisioningEventPayloadSchema,
  ingest_marketplace_event: marketplaceEventPayloadSchema,
  create_poc: createPocPayloadSchema,
  decide_poc: decidePocPayloadSchema,
  convert_poc: convertPocPayloadSchema,
  recover_provisioning: recoverProvisioningPayloadSchema,
  accept_pass_through_terms: acceptPassThroughPayloadSchema,
  record_inbound_notice: recordInboundNoticePayloadSchema,
  renewal_command_center: renewalCommandCenterPayloadSchema,
  request_renewal: requestRenewalPayloadSchema,
  decline_renewal: declineRenewalPayloadSchema,
  request_termination: requestTerminationPayloadSchema,
  decide_termination: decideTerminationPayloadSchema,
  create_novation: createNovationPayloadSchema,
  open_exception: openExceptionPayloadSchema,
  decide_exception: decideExceptionPayloadSchema,
  list_support_signals: listSupportSignalsPayloadSchema,
  start_migration: startMigrationPayloadSchema,
  decide_migration_match: decideMigrationMatchPayloadSchema,
} as const;

export type LifecycleCommandName = keyof typeof lifecyclePayloadSchemas;

export function parseLifecyclePayload<TCommand extends LifecycleCommandName>(
  command: TCommand,
  payload: unknown,
): unknown {
  return lifecyclePayloadSchemas[command].parse(payload);
}
