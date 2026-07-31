import { createHash } from "node:crypto";

const nonNegativeIntegerPattern = /^(0|[1-9]\d*)$/;
const unsignedDecimalPattern = /^(0|[1-9]\d*)(?:\.\d+)?$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function parseNonNegativeInteger(value: string, code: string): bigint {
  if (typeof value !== "string" || !nonNegativeIntegerPattern.test(value))
    throw new Error(code);
  return BigInt(value);
}

function assertUnsignedDecimal(
  value: string,
  options: { allowZero: boolean },
): void {
  if (typeof value !== "string" || !unsignedDecimalPattern.test(value))
    throw new Error("POC_CAP_INVALID");
  if (!options.allowZero && /^0(?:\.0+)?$/.test(value))
    throw new Error("POC_CAP_INVALID");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("POC_EVIDENCE_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("POC_EVIDENCE_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function hashPocEvidence(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export type PocStatus =
  "proposed" | "approved" | "active" | "expired" | "converted" | "closed";

export interface PocQualification {
  workload: string;
  buyerUserId: string;
  permittedDataClass: "synthetic" | "public" | "confidential" | "regulated";
  successTests: readonly { id: string; description: string }[];
  commercialRangeMinor: { minimum: string; maximum: string; currency: string };
  expiresAt: string;
  supportOwnerId: string;
}

export function qualifyPoc(input: PocQualification): {
  qualified: boolean;
  reasons: readonly string[];
} {
  const reasons: string[] = [];
  if (input.workload.trim().length < 8) reasons.push("WORKLOAD_NOT_DEFINED");
  if (!input.buyerUserId) reasons.push("BUYER_NOT_NAMED");
  if (input.successTests.length === 0)
    reasons.push("SUCCESS_TESTS_NOT_DEFINED");
  if (
    new Set(input.successTests.map((test) => test.id)).size !==
    input.successTests.length
  )
    reasons.push("SUCCESS_TEST_IDS_NOT_UNIQUE");
  let minimum: bigint | null = null;
  let maximum: bigint | null = null;
  try {
    minimum = parseNonNegativeInteger(
      input.commercialRangeMinor.minimum,
      "COMMERCIAL_RANGE_INVALID",
    );
    maximum = parseNonNegativeInteger(
      input.commercialRangeMinor.maximum,
      "COMMERCIAL_RANGE_INVALID",
    );
  } catch {
    reasons.push("COMMERCIAL_RANGE_INVALID");
  }
  if (minimum !== null && maximum !== null && maximum < minimum)
    reasons.push("COMMERCIAL_RANGE_INVALID");
  if (!Number.isFinite(Date.parse(input.expiresAt)))
    reasons.push("EXPIRY_INVALID");
  if (!input.supportOwnerId) reasons.push("SUPPORT_OWNER_REQUIRED");
  return { qualified: reasons.length === 0, reasons };
}

export interface PocEnvironmentPlan {
  pocId: string;
  organizationId: string;
  tenantId: string;
  isolated: true;
  capacityCap: string;
  egressCap: string;
  permittedDataClass: PocQualification["permittedDataClass"];
  keyNames: readonly string[];
  sandboxEntitlement: {
    sku: string;
    zeroPrice: true;
    expiresAt: string;
  };
  idempotencyKey: string;
}

export function createPocEnvironmentPlan(input: {
  pocId: string;
  organizationId: string;
  tenantId: string;
  capacityCap: string;
  egressCap: string;
  permittedDataClass: PocQualification["permittedDataClass"];
  keyNames: readonly string[];
  expiresAt: string;
  version: number;
}): PocEnvironmentPlan {
  if (input.keyNames.length === 0) throw new Error("NAMED_KEYS_REQUIRED");
  if (new Set(input.keyNames).size !== input.keyNames.length)
    throw new Error("KEY_NAMES_NOT_UNIQUE");
  assertUnsignedDecimal(input.capacityCap, { allowZero: false });
  assertUnsignedDecimal(input.egressCap, { allowZero: true });
  return {
    pocId: input.pocId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    isolated: true,
    capacityCap: input.capacityCap,
    egressCap: input.egressCap,
    permittedDataClass: input.permittedDataClass,
    keyNames: [...input.keyNames],
    sandboxEntitlement: {
      sku: "POC-SANDBOX",
      zeroPrice: true,
      expiresAt: input.expiresAt,
    },
    idempotencyKey: `poc:${createHash("sha256")
      .update(`${input.pocId}:${input.version}:provision`)
      .digest("hex")}`,
  };
}

export function pocMilestoneAlerts(input: {
  now: string;
  kickoffAt: string;
  midpointAt: string;
  finalReportAt: string;
  expiresAt: string;
  proposalLeadDays: number;
  alreadySent: readonly string[];
}): readonly { kind: string; dueAt: string }[] {
  const now = Date.parse(input.now);
  const candidates = [
    { kind: "kickoff", dueAt: input.kickoffAt },
    { kind: "midpoint", dueAt: input.midpointAt },
    { kind: "final_report", dueAt: input.finalReportAt },
    {
      kind: "proposal",
      dueAt: new Date(
        Date.parse(input.expiresAt) - input.proposalLeadDays * 86_400_000,
      ).toISOString(),
    },
    { kind: "expiry", dueAt: input.expiresAt },
  ];
  return candidates.filter(
    ({ kind, dueAt }) =>
      Date.parse(dueAt) <= now && !input.alreadySent.includes(kind),
  );
}

export interface PocCostSummary {
  infrastructureCostMinor: string;
  engineeringMinutes: number;
  engineeringCostMinor: string;
  totalCostMinor: string;
  currency: string;
}

export function summarizePocCost(input: {
  infrastructureCostMinor: string;
  engineeringMinutes: number;
  engineeringHourlyCostMinor: string;
  currency: string;
}): PocCostSummary {
  if (
    !Number.isSafeInteger(input.engineeringMinutes) ||
    input.engineeringMinutes < 0
  )
    throw new Error("ENGINEERING_MINUTES_INVALID");
  const infrastructure = parseNonNegativeInteger(
    input.infrastructureCostMinor,
    "INFRASTRUCTURE_COST_INVALID",
  );
  const engineeringHourly = parseNonNegativeInteger(
    input.engineeringHourlyCostMinor,
    "ENGINEERING_HOURLY_COST_INVALID",
  );
  const engineering =
    (engineeringHourly * BigInt(input.engineeringMinutes)) / 60n;
  return {
    infrastructureCostMinor: infrastructure.toString(),
    engineeringMinutes: input.engineeringMinutes,
    engineeringCostMinor: engineering.toString(),
    totalCostMinor: (infrastructure + engineering).toString(),
    currency: input.currency,
  };
}

export interface PocConversionPlan {
  pocId: string;
  quoteId: string;
  orderId: string;
  organizationId: string;
  tenantId: string;
  preserveData: true;
  preserveOrganization: true;
  preserveTenant: true;
  entitlementChanges: readonly {
    entitlementId: string;
    fromSku: string;
    toSku: string;
    removeCaps: true;
  }[];
  status: "converted";
  successEvidenceHash: string;
  quoteAcceptanceEvidenceHash: string;
}

export interface PocSuccessSnapshot {
  readonly snapshotId: string;
  readonly pocId: string;
  readonly source: "poc_milestone_ledger";
  readonly evaluatedAt: string;
  readonly evaluatorId: string;
  readonly tests: readonly {
    readonly testId: string;
    readonly passed: boolean;
    readonly evidenceHash: string;
  }[];
  readonly evidenceHash: string;
}

export interface PocQuoteAcceptanceEvidence {
  readonly quoteId: string;
  readonly acceptedAt: string;
  readonly acceptedBy: string;
  readonly exactQuoteHash: string;
  readonly evidenceHash: string;
}

function assertPocSuccessSnapshot(
  snapshot: PocSuccessSnapshot,
  pocId: string,
): void {
  if (
    !snapshot.snapshotId.trim() ||
    snapshot.pocId !== pocId ||
    snapshot.source !== "poc_milestone_ledger" ||
    !snapshot.evaluatorId.trim() ||
    !Number.isFinite(Date.parse(snapshot.evaluatedAt)) ||
    snapshot.tests.length === 0 ||
    new Set(snapshot.tests.map((test) => test.testId)).size !==
      snapshot.tests.length ||
    snapshot.tests.some(
      (test) => !test.testId.trim() || !sha256Pattern.test(test.evidenceHash),
    )
  )
    throw new Error("POC_SUCCESS_SNAPSHOT_INVALID");
  if (snapshot.tests.some((test) => !test.passed))
    throw new Error("POC_TESTS_INCOMPLETE");
  const { evidenceHash, ...payload } = snapshot;
  if (
    !sha256Pattern.test(evidenceHash) ||
    hashPocEvidence(payload) !== evidenceHash
  )
    throw new Error("POC_SUCCESS_EVIDENCE_HASH_MISMATCH");
}

function assertQuoteAcceptanceEvidence(
  evidence: PocQuoteAcceptanceEvidence,
  quoteId: string,
): void {
  if (
    evidence.quoteId !== quoteId ||
    !evidence.acceptedBy.trim() ||
    !Number.isFinite(Date.parse(evidence.acceptedAt)) ||
    !sha256Pattern.test(evidence.exactQuoteHash)
  )
    throw new Error("PAID_QUOTE_ACCEPTANCE_INVALID");
  const { evidenceHash, ...payload } = evidence;
  if (
    !sha256Pattern.test(evidenceHash) ||
    hashPocEvidence(payload) !== evidenceHash
  )
    throw new Error("PAID_QUOTE_EVIDENCE_HASH_MISMATCH");
}

/** Conversion changes entitlement policy in place; tenant and data identifiers never change. */
export function convertPocInPlace(input: {
  pocId: string;
  status: PocStatus;
  successSnapshot: PocSuccessSnapshot;
  quoteId: string;
  quoteAcceptance: PocQuoteAcceptanceEvidence;
  orderId: string;
  organizationId: string;
  tenantId: string;
  entitlements: readonly {
    entitlementId: string;
    sku: string;
    organizationId: string;
    tenantId: string;
    paidSku: string;
  }[];
}): PocConversionPlan {
  if (input.status !== "active") throw new Error("POC_NOT_ACTIVE");
  assertPocSuccessSnapshot(input.successSnapshot, input.pocId);
  assertQuoteAcceptanceEvidence(input.quoteAcceptance, input.quoteId);
  if (
    input.entitlements.some(
      (entitlement) =>
        entitlement.organizationId !== input.organizationId ||
        entitlement.tenantId !== input.tenantId,
    )
  )
    throw new Error("POC_TENANT_CONTINUITY_VIOLATION");
  return {
    pocId: input.pocId,
    quoteId: input.quoteId,
    orderId: input.orderId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    preserveData: true,
    preserveOrganization: true,
    preserveTenant: true,
    entitlementChanges: input.entitlements.map((entitlement) => ({
      entitlementId: entitlement.entitlementId,
      fromSku: entitlement.sku,
      toSku: entitlement.paidSku,
      removeCaps: true,
    })),
    status: "converted",
    successEvidenceHash: input.successSnapshot.evidenceHash,
    quoteAcceptanceEvidenceHash: input.quoteAcceptance.evidenceHash,
  };
}
