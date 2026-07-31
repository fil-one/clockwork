export type ScreeningDecision = "clear" | "review" | "blocked";
export type ScreeningReason =
  "registration" | "pre_signature" | "partner_activation" | "scheduled_refresh";

export interface ScreeningRecord {
  accountId: string;
  legalName: string;
  country: string;
  decision: ScreeningDecision;
  reason: ScreeningReason;
  providerReference: string;
  screenedAt: string;
  expiresAt: string;
  matchEvidenceDocumentId: string | null;
}

const embargoedCountries = new Set(["CU", "IR", "KP", "SY"]);

export function restrictedPartyGate(input: {
  accountId: string;
  legalName: string;
  country: string;
  reason: ScreeningReason;
  providerDecision: ScreeningDecision;
  providerReference: string;
  screenedAt: string;
  refreshDays: number;
  evidenceDocumentId?: string;
}): {
  record: ScreeningRecord;
  mayProceed: boolean;
  exceptionRequired: boolean;
} {
  const decision = embargoedCountries.has(input.country.toUpperCase())
    ? "blocked"
    : input.providerDecision;
  if (decision !== "clear" && !input.evidenceDocumentId)
    throw new Error("SCREENING_MATCH_EVIDENCE_REQUIRED");
  const record: ScreeningRecord = {
    accountId: input.accountId,
    legalName: input.legalName,
    country: input.country.toUpperCase(),
    decision,
    reason: input.reason,
    providerReference: input.providerReference,
    screenedAt: input.screenedAt,
    expiresAt: new Date(
      Date.parse(input.screenedAt) + input.refreshDays * 86_400_000,
    ).toISOString(),
    matchEvidenceDocumentId: input.evidenceDocumentId ?? null,
  };
  return {
    record,
    mayProceed: decision === "clear",
    exceptionRequired: decision === "review",
  };
}

export function screeningRequired(input: {
  reason: Exclude<ScreeningReason, "scheduled_refresh">;
  latest: ScreeningRecord | null;
  now: string;
}): boolean {
  if (!input.latest) return true;
  if (input.latest.decision !== "clear") return true;
  if (Date.parse(input.latest.expiresAt) <= Date.parse(input.now)) return true;
  return (
    input.reason === "pre_signature" || input.reason === "partner_activation"
  );
}

export type EvidenceAccessPurpose =
  | "business_owner_download"
  | "legal_review"
  | "malware_scan"
  | "retention_audit"
  | "provider_ingestion";

export interface EvidenceAccessRequest {
  actorId: string;
  accountIds: readonly string[];
  documentAccountId: string | null;
  internalRoles: readonly string[];
  purpose: EvidenceAccessPurpose;
  operation: "upload" | "download" | "metadata";
}

export function authorizeEvidenceAccess(input: EvidenceAccessRequest): void {
  const internal = input.internalRoles.some((role) =>
    ["internal_operator", "legal_approver"].includes(role),
  );
  const ownsDocument =
    input.documentAccountId !== null &&
    input.accountIds.includes(input.documentAccountId);
  if (input.purpose === "malware_scan" && !internal)
    throw new Error("MALWARE_SCANNER_ROLE_REQUIRED");
  if (input.purpose === "retention_audit" && !internal)
    throw new Error("RETENTION_AUDITOR_ROLE_REQUIRED");
  if (!internal && !ownsDocument) throw new Error("EVIDENCE_ACCOUNT_SCOPE");
  if (
    input.operation === "upload" &&
    !["provider_ingestion", "business_owner_download"].includes(input.purpose)
  )
    throw new Error("EVIDENCE_UPLOAD_PURPOSE_INVALID");
}

export interface ImmutableEvidenceMetadata {
  contentHash: string;
  storageKey: string;
  versionId: string;
  objectLockMode: "COMPLIANCE" | "GOVERNANCE";
  retainUntil: string;
  legalHold: boolean;
  malwareScanStatus: "pending" | "clean" | "quarantined";
}

export function validateImmutableEvidenceMetadata(
  input: ImmutableEvidenceMetadata,
  now: string,
): Readonly<ImmutableEvidenceMetadata> {
  if (!/^[a-f0-9]{64}$/.test(input.contentHash))
    throw new Error("EVIDENCE_HASH_INVALID");
  if (input.storageKey !== `sha256/${input.contentHash}`)
    throw new Error("EVIDENCE_KEY_NOT_CONTENT_ADDRESSED");
  if (!input.versionId) throw new Error("EVIDENCE_VERSION_REQUIRED");
  if (input.objectLockMode !== "COMPLIANCE")
    throw new Error("EVIDENCE_COMPLIANCE_LOCK_REQUIRED");
  if (Date.parse(input.retainUntil) <= Date.parse(now))
    throw new Error("EVIDENCE_RETENTION_INVALID");
  return Object.freeze({ ...input });
}

export function releaseEvidenceForDownload(input: {
  metadata: ImmutableEvidenceMetadata;
  requestedAt: string;
}): void {
  if (input.metadata.malwareScanStatus === "pending")
    throw new Error("EVIDENCE_SCAN_PENDING");
  if (input.metadata.malwareScanStatus === "quarantined")
    throw new Error("EVIDENCE_QUARANTINED");
  if (!Number.isFinite(Date.parse(input.requestedAt)))
    throw new Error("EVIDENCE_REQUEST_TIME_INVALID");
}
