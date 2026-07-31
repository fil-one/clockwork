import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type AgreementType =
  | "tos"
  | "csa"
  | "dpa"
  | "msa"
  | "order_form"
  | "poc_terms"
  | "end_user_terms"
  | "partner_agreement"
  | "addendum"
  | "nda"
  | "security_addendum"
  | "sla"
  | "support_policy"
  | "aup";

export type Jurisdiction = "US" | "EU" | "UK" | (string & {});
export type ExecutionMode = "click_through" | "counter_signed";
export type AgreementPaper = "ours" | "theirs";
export type NegotiationStatus =
  | "standard"
  | "uploaded"
  | "redlining"
  | "counsel_review"
  | "agreed"
  | "rejected";

export interface ImmutableEvidenceObject {
  readonly documentId: string;
  readonly kind:
    | "canonical_text"
    | "customer_paper"
    | "signed_pdf"
    | "completion_certificate"
    | "click_acceptance"
    | "other";
  readonly sha256: string;
  readonly storageKey: string;
  readonly versionId: string;
  readonly retainedUntil: string;
  readonly legalHold: boolean;
  readonly malwareScan: "clean";
  readonly recordedAt: string;
}

export interface CounselApproval {
  readonly approvalId: string;
  readonly approverUserId: string;
  readonly authority: "counsel";
  readonly approvedAt: string;
  readonly reviewedTextHash: string;
  readonly note: string;
}

export interface AgreementTemplate {
  readonly id: string;
  readonly seriesId: string;
  readonly type: AgreementType;
  readonly semanticVersion: string;
  readonly jurisdiction: Jurisdiction;
  readonly variant: string;
  readonly effectiveOn: string;
  readonly executionMode: ExecutionMode;
  readonly canonicalText: string;
  readonly textHash: string;
  readonly canonicalDocument: ImmutableEvidenceObject;
  readonly approvalStatus: "draft" | "approved" | "retired";
  readonly approval: CounselApproval | null;
  readonly createdAt: string;
  readonly retiredAt: string | null;
}

export interface TemplateInput {
  readonly id: string;
  readonly seriesId: string;
  readonly type: AgreementType;
  readonly semanticVersion: string;
  readonly jurisdiction: Jurisdiction;
  readonly variant: string;
  readonly effectiveOn: string;
  readonly executionMode: ExecutionMode;
  readonly canonicalText: string;
  readonly canonicalDocument: ImmutableEvidenceObject;
  readonly createdAt: string;
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const instantWithOffsetPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function assertLocalDate(value: string, code: string): void {
  invariant(localDatePattern.test(value), code);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day));
  invariant(
    date.getUTCFullYear() === year &&
      date.getUTCMonth() === (month ?? 0) - 1 &&
      date.getUTCDate() === day,
    code,
  );
}

function assertInstant(value: string, code: string): void {
  invariant(instantWithOffsetPattern.test(value), code);
  invariant(!Number.isNaN(Date.parse(value)), code);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function copyEvidence(
  evidence: ImmutableEvidenceObject,
  expectedKind?: ImmutableEvidenceObject["kind"],
): ImmutableEvidenceObject {
  invariant(
    evidence.documentId.trim().length > 0,
    "EVIDENCE_DOCUMENT_ID_REQUIRED",
  );
  invariant(sha256Pattern.test(evidence.sha256), "EVIDENCE_HASH_INVALID");
  invariant(
    evidence.storageKey.trim().length > 0,
    "EVIDENCE_STORAGE_KEY_REQUIRED",
  );
  invariant(evidence.versionId.trim().length > 0, "EVIDENCE_VERSION_REQUIRED");
  assertInstant(evidence.retainedUntil, "EVIDENCE_RETENTION_INVALID");
  assertInstant(evidence.recordedAt, "EVIDENCE_RECORDED_AT_INVALID");
  invariant(evidence.malwareScan === "clean", "EVIDENCE_NOT_CLEAN");
  if (expectedKind)
    invariant(evidence.kind === expectedKind, "EVIDENCE_KIND_MISMATCH");
  return { ...evidence };
}

/**
 * Legal text is never silently normalized. Authors must provide NFC, LF-only,
 * BOM-free text so the hash always identifies the exact UTF-8 bytes shown.
 */
export function assertCanonicalLegalText(text: string): void {
  invariant(text.length > 0, "CANONICAL_TEXT_REQUIRED");
  invariant(!text.startsWith("\uFEFF"), "CANONICAL_TEXT_BOM_FORBIDDEN");
  invariant(!text.includes("\r"), "CANONICAL_TEXT_MUST_USE_LF");
  invariant(text.normalize("NFC") === text, "CANONICAL_TEXT_MUST_BE_NFC");
}

export function hashExactText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "EVIDENCE_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  invariant(typeof value === "object", "EVIDENCE_VALUE_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function hashEvidence(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function createAgreementTemplate(
  input: TemplateInput,
): AgreementTemplate {
  invariant(input.id.trim().length > 0, "TEMPLATE_ID_REQUIRED");
  invariant(input.seriesId.trim().length > 0, "TEMPLATE_SERIES_ID_REQUIRED");
  invariant(
    semanticVersionPattern.test(input.semanticVersion),
    "TEMPLATE_VERSION_INVALID",
  );
  invariant(
    input.jurisdiction.trim().length > 0,
    "TEMPLATE_JURISDICTION_REQUIRED",
  );
  invariant(input.variant.trim().length > 0, "TEMPLATE_VARIANT_REQUIRED");
  assertLocalDate(input.effectiveOn, "TEMPLATE_EFFECTIVE_DATE_INVALID");
  assertInstant(input.createdAt, "TEMPLATE_CREATED_AT_INVALID");
  assertCanonicalLegalText(input.canonicalText);
  const textHash = hashExactText(input.canonicalText);
  const canonicalDocument = copyEvidence(
    input.canonicalDocument,
    "canonical_text",
  );
  invariant(
    canonicalDocument.sha256 === textHash,
    "CANONICAL_DOCUMENT_HASH_MISMATCH",
  );
  return deepFreeze({
    ...input,
    jurisdiction: input.jurisdiction,
    textHash,
    canonicalDocument,
    approvalStatus: "draft" as const,
    approval: null,
    retiredAt: null,
  });
}

function semverTuple(value: string): readonly [number, number, number] {
  const match = semanticVersionPattern.exec(value);
  invariant(match, "TEMPLATE_VERSION_INVALID");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function createNextTemplateVersion(
  previous: AgreementTemplate,
  input: TemplateInput,
): AgreementTemplate {
  invariant(previous.seriesId === input.seriesId, "TEMPLATE_SERIES_MISMATCH");
  invariant(previous.type === input.type, "TEMPLATE_TYPE_MISMATCH");
  const before = semverTuple(previous.semanticVersion);
  const after = semverTuple(input.semanticVersion);
  invariant(
    after[0] > before[0] ||
      (after[0] === before[0] && after[1] > before[1]) ||
      (after[0] === before[0] &&
        after[1] === before[1] &&
        after[2] > before[2]),
    "TEMPLATE_VERSION_NOT_INCREASING",
  );
  invariant(input.id !== previous.id, "TEMPLATE_VERSION_ID_REUSED");
  return createAgreementTemplate(input);
}

export function approveAgreementTemplate(
  template: AgreementTemplate,
  approval: CounselApproval,
): AgreementTemplate {
  invariant(template.approvalStatus === "draft", "TEMPLATE_NOT_DRAFT");
  invariant(
    approval.approvalId.trim().length > 0,
    "COUNSEL_APPROVAL_ID_REQUIRED",
  );
  invariant(
    approval.approverUserId.trim().length > 0,
    "COUNSEL_APPROVER_REQUIRED",
  );
  invariant(approval.authority === "counsel", "COUNSEL_AUTHORITY_REQUIRED");
  invariant(approval.note.trim().length > 0, "COUNSEL_APPROVAL_NOTE_REQUIRED");
  assertInstant(approval.approvedAt, "COUNSEL_APPROVAL_TIME_INVALID");
  invariant(
    Date.parse(approval.approvedAt) >= Date.parse(template.createdAt),
    "COUNSEL_APPROVAL_PRECEDES_TEMPLATE",
  );
  invariant(
    approval.reviewedTextHash === template.textHash &&
      hashExactText(template.canonicalText) === template.textHash,
    "COUNSEL_REVIEWED_HASH_MISMATCH",
  );
  return deepFreeze({
    ...template,
    approvalStatus: "approved" as const,
    approval: { ...approval, note: approval.note.trim() },
  });
}

export function retireAgreementTemplate(
  template: AgreementTemplate,
  retiredAt: string,
): AgreementTemplate {
  invariant(template.approvalStatus === "approved", "TEMPLATE_NOT_APPROVED");
  assertInstant(retiredAt, "TEMPLATE_RETIRED_AT_INVALID");
  return deepFreeze({
    ...template,
    approvalStatus: "retired" as const,
    retiredAt,
  });
}

export interface KeyTerms {
  readonly slaCreditSchedule: Readonly<Record<string, string>>;
  readonly liabilityCap: {
    readonly currency: "USD" | "EUR" | "GBP";
    readonly minor: string;
  } | null;
  readonly breachNoticeHours: number;
  readonly renewalPriceProtectionBasisPoints: number | null;
  readonly auditRights: string;
  readonly retentionLiabilityRule:
    "liable_through_retention" | "capped_at_paid_term" | "custom";
  readonly customRetentionRule: string | null;
  readonly survivalRules: readonly SurvivalRule[];
  readonly customTerms: Readonly<Record<string, string>>;
}

export interface SurvivalRule {
  readonly clause:
    | "payment"
    | "liability"
    | "data_protection"
    | "audit"
    | "confidentiality"
    | "custom";
  readonly customClause: string | null;
  readonly duration:
    | { readonly kind: "perpetual" }
    | { readonly kind: "in_flight_orders" }
    | { readonly kind: "fixed_days"; readonly days: number };
}

function copyKeyTerms(keyTerms: KeyTerms): KeyTerms {
  invariant(
    Number.isInteger(keyTerms.breachNoticeHours) &&
      keyTerms.breachNoticeHours > 0,
    "BREACH_NOTICE_HOURS_INVALID",
  );
  invariant(keyTerms.auditRights.trim().length > 0, "AUDIT_RIGHTS_REQUIRED");
  if (keyTerms.liabilityCap) {
    invariant(
      /^-?(0|[1-9]\d*)$/.test(keyTerms.liabilityCap.minor),
      "LIABILITY_CAP_INVALID",
    );
  }
  if (keyTerms.renewalPriceProtectionBasisPoints !== null)
    invariant(
      Number.isInteger(keyTerms.renewalPriceProtectionBasisPoints) &&
        keyTerms.renewalPriceProtectionBasisPoints >= 0 &&
        keyTerms.renewalPriceProtectionBasisPoints <= 10_000,
      "RENEWAL_PRICE_PROTECTION_INVALID",
    );
  invariant(
    keyTerms.retentionLiabilityRule !== "custom" ||
      Boolean(keyTerms.customRetentionRule?.trim()),
    "CUSTOM_RETENTION_RULE_REQUIRED",
  );
  for (const rule of keyTerms.survivalRules) {
    invariant(
      rule.clause !== "custom" || Boolean(rule.customClause?.trim()),
      "CUSTOM_SURVIVAL_CLAUSE_REQUIRED",
    );
    if (rule.duration.kind === "fixed_days")
      invariant(
        Number.isInteger(rule.duration.days) && rule.duration.days > 0,
        "SURVIVAL_DAYS_INVALID",
      );
  }
  return {
    ...keyTerms,
    slaCreditSchedule: { ...keyTerms.slaCreditSchedule },
    survivalRules: keyTerms.survivalRules.map((rule) => ({
      ...rule,
      duration: { ...rule.duration },
    })),
    customTerms: { ...keyTerms.customTerms },
  };
}

export interface AgreementTerm {
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly renewalType: "auto_renew" | "expires";
  readonly renewalMonths: number | null;
  readonly noticeDays: number;
  readonly timeZone: string;
}

function copyTerm(term: AgreementTerm): AgreementTerm {
  assertLocalDate(term.startsOn, "AGREEMENT_START_DATE_INVALID");
  if (term.endsOn) {
    assertLocalDate(term.endsOn, "AGREEMENT_END_DATE_INVALID");
    invariant(term.endsOn > term.startsOn, "AGREEMENT_TERM_INVALID");
  }
  invariant(
    Number.isInteger(term.noticeDays) && term.noticeDays >= 0,
    "NOTICE_DAYS_INVALID",
  );
  invariant(
    term.renewalType !== "auto_renew" ||
      (term.endsOn !== null &&
        term.renewalMonths !== null &&
        Number.isInteger(term.renewalMonths) &&
        term.renewalMonths > 0),
    "AUTO_RENEW_TERM_INVALID",
  );
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: term.timeZone }).format();
  } catch {
    throw new Error("AGREEMENT_TIME_ZONE_INVALID");
  }
  return { ...term };
}

export interface AgreementDraft {
  readonly id: string;
  readonly accountId: string;
  readonly legalEntityName: string;
  readonly paper: AgreementPaper;
  readonly template: Pick<
    AgreementTemplate,
    | "id"
    | "seriesId"
    | "semanticVersion"
    | "type"
    | "jurisdiction"
    | "textHash"
    | "executionMode"
  > | null;
  readonly customerPaper: ImmutableEvidenceObject | null;
  readonly executionMode: ExecutionMode;
  readonly negotiationStatus: NegotiationStatus;
  readonly term: AgreementTerm;
  readonly createdAt: string;
}

function templateSnapshot(
  template: AgreementTemplate,
): NonNullable<AgreementDraft["template"]> {
  return {
    id: template.id,
    seriesId: template.seriesId,
    semanticVersion: template.semanticVersion,
    type: template.type,
    jurisdiction: template.jurisdiction,
    textHash: template.textHash,
    executionMode: template.executionMode,
  };
}

export function createOurPaperAgreement(input: {
  readonly id: string;
  readonly accountId: string;
  readonly legalEntityName: string;
  readonly template: AgreementTemplate;
  readonly term: AgreementTerm;
  readonly createdAt: string;
}): AgreementDraft {
  invariant(
    input.template.approvalStatus === "approved",
    "TEMPLATE_COUNSEL_APPROVAL_REQUIRED",
  );
  invariant(
    input.template.approval !== null,
    "TEMPLATE_COUNSEL_APPROVAL_REQUIRED",
  );
  invariant(
    hashExactText(input.template.canonicalText) === input.template.textHash,
    "TEMPLATE_IMMUTABILITY_VIOLATION",
  );
  assertInstant(input.createdAt, "AGREEMENT_CREATED_AT_INVALID");
  invariant(
    input.term.startsOn >= input.template.effectiveOn,
    "AGREEMENT_BEFORE_TEMPLATE_EFFECTIVE_DATE",
  );
  return deepFreeze({
    id: input.id,
    accountId: input.accountId,
    legalEntityName: input.legalEntityName.trim(),
    paper: "ours" as const,
    template: templateSnapshot(input.template),
    customerPaper: null,
    executionMode: input.template.executionMode,
    negotiationStatus: "standard" as const,
    term: copyTerm(input.term),
    createdAt: input.createdAt,
  });
}

export function createCustomerPaperAgreement(input: {
  readonly id: string;
  readonly accountId: string;
  readonly legalEntityName: string;
  readonly customerPaper: ImmutableEvidenceObject;
  readonly term: AgreementTerm;
  readonly uploadedAt: string;
}): AgreementDraft {
  assertInstant(input.uploadedAt, "CUSTOMER_PAPER_UPLOAD_TIME_INVALID");
  return deepFreeze({
    id: input.id,
    accountId: input.accountId,
    legalEntityName: input.legalEntityName.trim(),
    paper: "theirs" as const,
    template: null,
    customerPaper: copyEvidence(input.customerPaper, "customer_paper"),
    executionMode: "counter_signed" as const,
    negotiationStatus: "uploaded" as const,
    term: copyTerm(input.term),
    createdAt: input.uploadedAt,
  });
}

const negotiationTransitions: Readonly<
  Record<NegotiationStatus, readonly NegotiationStatus[]>
> = {
  standard: ["redlining", "counsel_review", "agreed", "rejected"],
  uploaded: ["redlining", "counsel_review", "rejected"],
  redlining: ["counsel_review", "rejected"],
  counsel_review: ["redlining", "agreed", "rejected"],
  agreed: [],
  rejected: [],
};

export function transitionNegotiation(
  agreement: AgreementDraft,
  to: NegotiationStatus,
): AgreementDraft {
  invariant(
    negotiationTransitions[agreement.negotiationStatus].includes(to),
    "NEGOTIATION_TRANSITION_INVALID",
  );
  return deepFreeze({ ...agreement, negotiationStatus: to });
}

export interface ClickIdentityEvidence {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly accountId: string;
  readonly organizationId: string;
}

export interface ClickUiContext {
  readonly route: string;
  readonly action: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly userAgent: string;
  readonly locale: string;
}

export interface ClickAcceptanceEvidence {
  readonly kind: "click_through";
  readonly evidenceId: string;
  readonly agreementId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly templateTextHash: string;
  readonly identity: ClickIdentityEvidence;
  readonly acceptedAt: string;
  readonly ipAddress: string;
  readonly uiContext: ClickUiContext;
  readonly authorityTitle: string;
  readonly authorityAttested: true;
  readonly authorityAttestation: string;
  readonly commercialValueSnapshotId: string;
  readonly commercialValueSnapshotHash: string;
  readonly commercialValueSnapshotCapturedAt: string;
  readonly cumulativeValueBeforeMinor: string;
  readonly commercialEventValueMinor: string;
  readonly cumulativeValueAfterMinor: string;
  readonly currency: "USD" | "EUR" | "GBP";
  readonly thresholdMinor: string;
  readonly evidenceHash: string;
}

function nonNegativeMinor(value: string, code: string): bigint {
  invariant(typeof value === "string" && /^(0|[1-9]\d*)$/.test(value), code);
  return BigInt(value);
}

export interface CommercialValueSnapshot {
  readonly snapshotId: string;
  readonly accountId: string;
  readonly source: "commerce_ledger";
  readonly capturedAt: string;
  readonly commercialEventId: string;
  readonly cumulativeValueBeforeMinor: string;
  readonly commercialEventValueMinor: string;
  readonly currency: "USD" | "EUR" | "GBP";
  readonly evidenceHash: string;
}

function validateCommercialValueSnapshot(snapshot: CommercialValueSnapshot): {
  readonly before: bigint;
  readonly eventValue: bigint;
} {
  invariant(
    snapshot.snapshotId.trim().length > 0,
    "VALUE_SNAPSHOT_ID_REQUIRED",
  );
  invariant(
    snapshot.accountId.trim().length > 0,
    "VALUE_SNAPSHOT_ACCOUNT_REQUIRED",
  );
  invariant(
    snapshot.source === "commerce_ledger",
    "VALUE_SNAPSHOT_SOURCE_INVALID",
  );
  invariant(
    snapshot.commercialEventId.trim().length > 0,
    "COMMERCIAL_EVENT_ID_REQUIRED",
  );
  assertInstant(snapshot.capturedAt, "VALUE_SNAPSHOT_TIME_INVALID");
  const before = nonNegativeMinor(
    snapshot.cumulativeValueBeforeMinor,
    "CUMULATIVE_VALUE_INVALID",
  );
  const eventValue = nonNegativeMinor(
    snapshot.commercialEventValueMinor,
    "COMMERCIAL_EVENT_VALUE_INVALID",
  );
  const { evidenceHash, ...payload } = snapshot;
  invariant(sha256Pattern.test(evidenceHash), "VALUE_SNAPSHOT_HASH_INVALID");
  invariant(
    hashEvidence(payload) === evidenceHash,
    "VALUE_SNAPSHOT_HASH_MISMATCH",
  );
  return { before, eventValue };
}

export interface ExecutionRequirement {
  readonly mode: ExecutionMode;
  readonly reexecutionRequired: boolean;
  readonly reasons: readonly string[];
  readonly cumulativeValueAfterMinor: string;
  readonly commercialValueSnapshotId: string;
  readonly commercialValueSnapshotHash: string;
}

export function decideExecutionRequirement(input: {
  readonly template: AgreementTemplate;
  readonly commercialValueSnapshot: CommercialValueSnapshot;
  readonly thresholdMinor: string;
  readonly activeAgreement: {
    readonly executionMode: ExecutionMode;
    readonly templateId: string | null;
    readonly templateTextHash: string;
  } | null;
  readonly termsChanged?: boolean;
  readonly agreementTypeChanged?: boolean;
  readonly discountTierChanged?: boolean;
  readonly redlined?: boolean;
}): ExecutionRequirement {
  const { before, eventValue } = validateCommercialValueSnapshot(
    input.commercialValueSnapshot,
  );
  const threshold = nonNegativeMinor(
    input.thresholdMinor,
    "CLICK_THRESHOLD_INVALID",
  );
  invariant(threshold > 0n, "CLICK_THRESHOLD_INVALID");
  const after = before + eventValue;
  const reasons: string[] = [];
  if (!input.activeAgreement) reasons.push("NO_ACTIVE_AGREEMENT");
  if (
    input.activeAgreement &&
    (input.activeAgreement.templateId !== input.template.id ||
      input.activeAgreement.templateTextHash !== input.template.textHash)
  )
    reasons.push("TEMPLATE_VERSION_CHANGED");
  if (input.termsChanged) reasons.push("TERMS_CHANGED");
  if (input.agreementTypeChanged) reasons.push("AGREEMENT_TYPE_CHANGED");
  if (input.discountTierChanged) reasons.push("DISCOUNT_TIER_CHANGED");
  if (input.redlined) reasons.push("REDLINED");
  if (after >= threshold) reasons.push("CUMULATIVE_VALUE_THRESHOLD_REACHED");
  const forcedCounterSignature =
    input.template.executionMode === "counter_signed" ||
    input.template.type === "msa" ||
    input.template.type === "partner_agreement" ||
    Boolean(input.redlined) ||
    after >= threshold;
  return deepFreeze({
    mode: forcedCounterSignature ? "counter_signed" : "click_through",
    reexecutionRequired:
      input.activeAgreement === null ||
      reasons.some((reason) => reason !== "NO_ACTIVE_AGREEMENT"),
    reasons,
    cumulativeValueAfterMinor: after.toString(),
    commercialValueSnapshotId: input.commercialValueSnapshot.snapshotId,
    commercialValueSnapshotHash: input.commercialValueSnapshot.evidenceHash,
  });
}

export function captureClickAcceptance(input: {
  readonly evidenceId: string;
  readonly agreementId: string;
  readonly legalEntityName: string;
  readonly template: AgreementTemplate;
  readonly exactTextPresented: string;
  readonly identity: ClickIdentityEvidence;
  readonly acceptedAt: string;
  readonly ipAddress: string;
  readonly uiContext: ClickUiContext;
  readonly authorityTitle: string;
  readonly authorityAttested: boolean;
  readonly commercialValueSnapshot: CommercialValueSnapshot;
  readonly thresholdMinor: string;
}): ClickAcceptanceEvidence {
  invariant(
    input.template.approvalStatus === "approved",
    "TEMPLATE_COUNSEL_APPROVAL_REQUIRED",
  );
  invariant(
    input.template.executionMode === "click_through",
    "TEMPLATE_NOT_CLICK_THROUGH",
  );
  invariant(
    hashExactText(input.exactTextPresented) === input.template.textHash,
    "PRESENTED_TEXT_HASH_MISMATCH",
  );
  invariant(
    input.identity.accountId.trim().length > 0,
    "ACCEPTING_ACCOUNT_REQUIRED",
  );
  invariant(
    input.identity.userId.trim().length > 0,
    "ACCEPTING_IDENTITY_REQUIRED",
  );
  invariant(input.identity.email.includes("@"), "ACCEPTING_EMAIL_INVALID");
  invariant(input.identity.role.trim().length > 0, "ACCEPTING_ROLE_REQUIRED");
  invariant(input.authorityTitle.trim().length > 0, "AUTHORITY_TITLE_REQUIRED");
  invariant(input.authorityAttested, "AUTHORITY_ATTESTATION_REQUIRED");
  assertInstant(input.acceptedAt, "ACCEPTED_AT_INVALID");
  invariant(isIP(input.ipAddress) !== 0, "ACCEPTED_IP_INVALID");
  invariant(input.uiContext.route.startsWith("/"), "UI_ROUTE_INVALID");
  for (const value of [
    input.uiContext.action,
    input.uiContext.sessionId,
    input.uiContext.requestId,
    input.uiContext.userAgent,
    input.uiContext.locale,
  ])
    invariant(value.trim().length > 0, "UI_CONTEXT_INCOMPLETE");
  const { before, eventValue } = validateCommercialValueSnapshot(
    input.commercialValueSnapshot,
  );
  invariant(
    input.commercialValueSnapshot.accountId === input.identity.accountId,
    "VALUE_SNAPSHOT_ACCOUNT_MISMATCH",
  );
  invariant(
    Date.parse(input.commercialValueSnapshot.capturedAt) <=
      Date.parse(input.acceptedAt),
    "VALUE_SNAPSHOT_AFTER_ACCEPTANCE",
  );
  const threshold = nonNegativeMinor(
    input.thresholdMinor,
    "CLICK_THRESHOLD_INVALID",
  );
  invariant(
    threshold > 0n && before + eventValue < threshold,
    "COUNTER_SIGNATURE_REQUIRED",
  );
  const authorityAttestation = `I am authorized to bind ${input.legalEntityName.trim()}`;
  const evidenceWithoutHash = {
    kind: "click_through" as const,
    evidenceId: input.evidenceId,
    agreementId: input.agreementId,
    templateId: input.template.id,
    templateVersion: input.template.semanticVersion,
    templateTextHash: input.template.textHash,
    identity: { ...input.identity },
    acceptedAt: input.acceptedAt,
    ipAddress: input.ipAddress,
    uiContext: { ...input.uiContext },
    authorityTitle: input.authorityTitle.trim(),
    authorityAttested: true as const,
    authorityAttestation,
    commercialValueSnapshotId: input.commercialValueSnapshot.snapshotId,
    commercialValueSnapshotHash: input.commercialValueSnapshot.evidenceHash,
    commercialValueSnapshotCapturedAt: input.commercialValueSnapshot.capturedAt,
    cumulativeValueBeforeMinor: before.toString(),
    commercialEventValueMinor: eventValue.toString(),
    cumulativeValueAfterMinor: (before + eventValue).toString(),
    currency: input.commercialValueSnapshot.currency,
    thresholdMinor: threshold.toString(),
  };
  return deepFreeze({
    ...evidenceWithoutHash,
    evidenceHash: hashEvidence(evidenceWithoutHash),
  });
}

export type EnvelopeState =
  | "created"
  | "sent"
  | "viewed"
  | "signed"
  | "provider_completed"
  | "completed"
  | "declined"
  | "voided"
  | "expired";

export interface EnvelopeEvent {
  readonly providerEventId: string;
  readonly envelopeId: string;
  readonly type:
    | "sent"
    | "viewed"
    | "signed"
    | "completed"
    | "declined"
    | "voided"
    | "expired";
  readonly occurredAt: string;
  readonly signerEmail: string | null;
}

export interface CounterSignatureEnvelope {
  readonly envelopeId: string;
  readonly agreementId: string;
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly signingMode: "redirect" | "embedded";
  readonly signingUrl: string | null;
  readonly state: EnvelopeState;
  readonly processedProviderEventIds: readonly string[];
  readonly stateChangedAt: string;
  readonly signerEmails: readonly string[];
  readonly signedPdf: ImmutableEvidenceObject | null;
  readonly completionCertificate: ImmutableEvidenceObject | null;
}

export function createCounterSignatureEnvelope(input: {
  readonly envelopeId: string;
  readonly agreementId: string;
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly signingMode: "redirect" | "embedded";
  readonly signingUrl?: string | null;
  readonly createdAt: string;
}): CounterSignatureEnvelope {
  invariant(input.envelopeId.trim().length > 0, "ENVELOPE_ID_REQUIRED");
  invariant(input.provider.trim().length > 0, "ENVELOPE_PROVIDER_REQUIRED");
  invariant(
    input.idempotencyKey.length >= 16,
    "ENVELOPE_IDEMPOTENCY_KEY_INVALID",
  );
  assertInstant(input.createdAt, "ENVELOPE_CREATED_AT_INVALID");
  if (input.signingMode === "redirect")
    invariant(Boolean(input.signingUrl), "REDIRECT_SIGNING_URL_REQUIRED");
  return deepFreeze({
    envelopeId: input.envelopeId,
    agreementId: input.agreementId,
    provider: input.provider,
    idempotencyKey: input.idempotencyKey,
    signingMode: input.signingMode,
    signingUrl: input.signingUrl ?? null,
    state: "created" as const,
    processedProviderEventIds: [],
    stateChangedAt: input.createdAt,
    signerEmails: [],
    signedPdf: null,
    completionCertificate: null,
  });
}

const envelopeRank: Readonly<Record<EnvelopeState, number>> = {
  created: 0,
  sent: 1,
  viewed: 2,
  signed: 3,
  provider_completed: 4,
  completed: 5,
  declined: 5,
  voided: 5,
  expired: 5,
};
const terminalEnvelopeStates = new Set<EnvelopeState>([
  "completed",
  "declined",
  "voided",
  "expired",
]);

export function applyEnvelopeEvent(
  envelope: CounterSignatureEnvelope,
  event: EnvelopeEvent,
): {
  readonly envelope: CounterSignatureEnvelope;
  readonly outcome: "applied" | "duplicate" | "stale";
} {
  invariant(
    event.envelopeId === envelope.envelopeId,
    "ENVELOPE_EVENT_SCOPE_MISMATCH",
  );
  invariant(
    event.providerEventId.trim().length > 0,
    "PROVIDER_EVENT_ID_REQUIRED",
  );
  assertInstant(event.occurredAt, "ENVELOPE_EVENT_TIME_INVALID");
  if (envelope.processedProviderEventIds.includes(event.providerEventId))
    return { envelope, outcome: "duplicate" };
  const target: EnvelopeState =
    event.type === "completed" ? "provider_completed" : event.type;
  const processedProviderEventIds = [
    ...envelope.processedProviderEventIds,
    event.providerEventId,
  ];
  if (terminalEnvelopeStates.has(envelope.state)) {
    if (
      target === envelope.state ||
      (envelope.state === "completed" && target === "provider_completed") ||
      envelopeRank[target] <= envelopeRank.signed
    )
      return deepFreeze({
        envelope: { ...envelope, processedProviderEventIds },
        outcome: "stale" as const,
      });
    throw new Error("ENVELOPE_TERMINAL_CONFLICT");
  }
  if (envelope.state === "provider_completed") {
    if (envelopeRank[target] <= envelopeRank.provider_completed)
      return deepFreeze({
        envelope: { ...envelope, processedProviderEventIds },
        outcome: "stale" as const,
      });
    throw new Error("ENVELOPE_TERMINAL_CONFLICT");
  }
  if (envelopeRank[target] <= envelopeRank[envelope.state])
    return deepFreeze({
      envelope: { ...envelope, processedProviderEventIds },
      outcome: "stale" as const,
    });
  const signerEmails = event.signerEmail
    ? [...new Set([...envelope.signerEmails, event.signerEmail.toLowerCase()])]
    : [...envelope.signerEmails];
  return deepFreeze({
    envelope: {
      ...envelope,
      state: target,
      stateChangedAt: event.occurredAt,
      processedProviderEventIds,
      signerEmails,
    },
    outcome: "applied" as const,
  });
}

export function ingestCounterSignatureEvidence(
  envelope: CounterSignatureEnvelope,
  input: {
    readonly signedPdf: ImmutableEvidenceObject;
    readonly completionCertificate: ImmutableEvidenceObject;
    readonly ingestedAt: string;
  },
): CounterSignatureEnvelope {
  invariant(
    envelope.state === "provider_completed",
    "ENVELOPE_NOT_PROVIDER_COMPLETED",
  );
  assertInstant(input.ingestedAt, "ENVELOPE_EVIDENCE_TIME_INVALID");
  return deepFreeze({
    ...envelope,
    state: "completed" as const,
    stateChangedAt: input.ingestedAt,
    signedPdf: copyEvidence(input.signedPdf, "signed_pdf"),
    completionCertificate: copyEvidence(
      input.completionCertificate,
      "completion_certificate",
    ),
  });
}

export interface ExecutedAgreement {
  readonly id: string;
  readonly accountId: string;
  readonly legalEntityName: string;
  readonly paper: AgreementPaper;
  readonly template: AgreementDraft["template"];
  readonly customerPaper: ImmutableEvidenceObject | null;
  readonly executionMode: ExecutionMode;
  readonly negotiationStatus: "standard" | "agreed";
  readonly executionEvidence:
    | ClickAcceptanceEvidence
    | {
        readonly kind: "counter_signed";
        readonly envelopeId: string;
        readonly provider: string;
        readonly providerEventIds: readonly string[];
        readonly idempotencyKey: string;
        readonly signingMode: "redirect" | "embedded";
        readonly signerEmails: readonly string[];
        readonly signedPdf: ImmutableEvidenceObject;
        readonly completionCertificate: ImmutableEvidenceObject;
        readonly completedAt: string;
      };
  readonly keyTerms: KeyTerms;
  readonly term: AgreementTerm;
  readonly effectiveOn: string;
  readonly status:
    "active" | "in_notice" | "expired" | "terminated" | "superseded";
  readonly terminatedOn: string | null;
  readonly supersededById: string | null;
  readonly lifecycleVersion: number;
}

export function executeClickThroughAgreement(
  draft: AgreementDraft,
  evidence: ClickAcceptanceEvidence,
  keyTerms: KeyTerms,
): ExecutedAgreement {
  invariant(
    draft.paper === "ours" && draft.template !== null,
    "CLICK_EXECUTION_REQUIRES_OUR_TEMPLATE",
  );
  invariant(
    draft.executionMode === "click_through",
    "AGREEMENT_NOT_CLICK_THROUGH",
  );
  invariant(
    draft.negotiationStatus === "standard",
    "NEGOTIATED_AGREEMENT_REQUIRES_COUNTER_SIGNATURE",
  );
  invariant(
    evidence.agreementId === draft.id,
    "CLICK_EVIDENCE_AGREEMENT_MISMATCH",
  );
  invariant(
    evidence.identity.accountId === draft.accountId,
    "CLICK_EVIDENCE_ACCOUNT_MISMATCH",
  );
  invariant(
    evidence.templateId === draft.template.id &&
      evidence.templateVersion === draft.template.semanticVersion &&
      evidence.templateTextHash === draft.template.textHash,
    "CLICK_EVIDENCE_TEMPLATE_MISMATCH",
  );
  const { evidenceHash, ...evidenceBody } = evidence;
  invariant(
    hashEvidence(evidenceBody) === evidenceHash,
    "CLICK_EVIDENCE_HASH_MISMATCH",
  );
  return deepFreeze({
    ...draft,
    negotiationStatus: "standard" as const,
    executionEvidence: { ...evidence },
    keyTerms: copyKeyTerms(keyTerms),
    effectiveOn: draft.term.startsOn,
    status: "active" as const,
    terminatedOn: null,
    supersededById: null,
    lifecycleVersion: 1,
  });
}

export function executeCounterSignedAgreement(
  draft: AgreementDraft,
  envelope: CounterSignatureEnvelope,
  keyTerms: KeyTerms,
): ExecutedAgreement {
  invariant(
    draft.executionMode === "counter_signed",
    "AGREEMENT_NOT_COUNTER_SIGNED",
  );
  invariant(envelope.agreementId === draft.id, "ENVELOPE_AGREEMENT_MISMATCH");
  invariant(
    envelope.state === "completed",
    "COUNTER_SIGNATURE_EVIDENCE_INCOMPLETE",
  );
  invariant(
    envelope.signedPdf && envelope.completionCertificate,
    "COUNTER_SIGNATURE_EVIDENCE_INCOMPLETE",
  );
  invariant(
    draft.negotiationStatus === "standard" ||
      draft.negotiationStatus === "agreed",
    "NEGOTIATION_NOT_AGREED",
  );
  if (draft.paper === "theirs")
    invariant(
      draft.negotiationStatus === "agreed",
      "CUSTOMER_PAPER_NOT_AGREED",
    );
  return deepFreeze({
    ...draft,
    negotiationStatus: draft.negotiationStatus,
    executionEvidence: {
      kind: "counter_signed" as const,
      envelopeId: envelope.envelopeId,
      provider: envelope.provider,
      providerEventIds: [...envelope.processedProviderEventIds],
      idempotencyKey: envelope.idempotencyKey,
      signingMode: envelope.signingMode,
      signerEmails: [...envelope.signerEmails],
      signedPdf: { ...envelope.signedPdf },
      completionCertificate: { ...envelope.completionCertificate },
      completedAt: envelope.stateChangedAt,
    },
    keyTerms: copyKeyTerms(keyTerms),
    effectiveOn: draft.term.startsOn,
    status: "active" as const,
    terminatedOn: null,
    supersededById: null,
    lifecycleVersion: 1,
  });
}

function addCalendarDays(date: string, days: number): string {
  assertLocalDate(date, "CALENDAR_DATE_INVALID");
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(
    Date.UTC(year ?? 0, (month ?? 0) - 1, (day ?? 0) + days),
  );
  return result.toISOString().slice(0, 10);
}

export function evaluateAgreementTerm(
  agreement: ExecutedAgreement,
  asOfDate: string,
  inFlightOrders: boolean,
): {
  readonly status: ExecutedAgreement["status"];
  readonly noticeOpensOn: string | null;
  readonly activeSurvivalClauses: readonly string[];
} {
  assertLocalDate(asOfDate, "AS_OF_DATE_INVALID");
  const termEnded =
    agreement.term.endsOn !== null && asOfDate > agreement.term.endsOn;
  const terminated =
    agreement.terminatedOn !== null && asOfDate >= agreement.terminatedOn;
  const noticeOpensOn = agreement.term.endsOn
    ? addCalendarDays(agreement.term.endsOn, -agreement.term.noticeDays)
    : null;
  const status =
    agreement.status === "superseded"
      ? "superseded"
      : terminated
        ? "terminated"
        : termEnded
          ? "expired"
          : noticeOpensOn && asOfDate >= noticeOpensOn
            ? "in_notice"
            : "active";
  const activeSurvivalClauses =
    status === "expired" || status === "terminated" || status === "superseded"
      ? agreement.keyTerms.survivalRules
          .filter((rule) => {
            if (rule.duration.kind === "perpetual") return true;
            if (rule.duration.kind === "in_flight_orders")
              return inFlightOrders;
            const end = agreement.terminatedOn ?? agreement.term.endsOn;
            return (
              end !== null &&
              asOfDate <= addCalendarDays(end, rule.duration.days)
            );
          })
          .map((rule) => rule.customClause ?? rule.clause)
      : [];
  return deepFreeze({ status, noticeOpensOn, activeSurvivalClauses });
}

export function supersedeAgreement(
  current: ExecutedAgreement,
  replacement: ExecutedAgreement,
  supersededOn: string,
): ExecutedAgreement {
  assertLocalDate(supersededOn, "SUPERSESSION_DATE_INVALID");
  invariant(
    current.accountId === replacement.accountId,
    "SUPERSESSION_ACCOUNT_MISMATCH",
  );
  invariant(current.id !== replacement.id, "SUPERSESSION_SELF_REFERENCE");
  invariant(
    current.status === "active" || current.status === "in_notice",
    "AGREEMENT_NOT_SUPERSEDABLE",
  );
  invariant(replacement.status === "active", "REPLACEMENT_NOT_ACTIVE");
  invariant(
    supersededOn >= replacement.effectiveOn,
    "SUPERSESSION_BEFORE_REPLACEMENT",
  );
  return deepFreeze({
    ...current,
    status: "superseded" as const,
    supersededById: replacement.id,
    lifecycleVersion: current.lifecycleVersion + 1,
  });
}
