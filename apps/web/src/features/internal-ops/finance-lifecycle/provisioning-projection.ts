import type { ProjectionRecord } from "@/src/features/experience-server/model";

import {
  authoritative,
  integer,
  recordEvidence,
  risk,
  text,
  type EvidenceEntry,
  type ProjectionRisk,
} from "./projection-fields";

/**
 * The internal `provisioning` channel carries two aggregates, not one:
 * `termination` and `provider_operation` both route to it in
 * `aggregateConfiguration`. They are different work -- one is a service ending,
 * the other is a provider call that has to land -- so the row states which it
 * is instead of flattening both into a single "operation".
 */
export type ProvisioningKind = "provider_operation" | "termination";

export interface ProvisioningWork {
  id: string;
  aggregateId: string;
  accountId: string | null;
  /** `null` when the projection row does not identify its aggregate. */
  kind: ProvisioningKind | null;
  kindLabel: string;
  reference: string;
  title: string;
  description: string | null;
  status: string | null;
  statusLabel: string;
  risk: ProjectionRisk | null;
  /** Provider operations only. `null` on a termination, which has no attempts. */
  attemptCount: number | null;
  /** Provider operations only. */
  nextAttemptLabel: string | null;
  provider: string | null;
  owner: string | null;
  nextAction: string | null;
  evidence: readonly EvidenceEntry[];
  version: number;
  updatedAt: string;
}

const kindLabels: Readonly<Record<ProvisioningKind, string>> = {
  provider_operation: "Provider operation",
  termination: "Service termination",
};

/**
 * Which aggregate a row came from.
 *
 * `aggregateType` is authoritative when the database projection source wrote
 * it. The demo source stores the channel there instead, so the record key --
 * which the materializer builds as `<aggregateType>-<aggregateId>` -- is
 * checked next. When neither answers, the row says so rather than being
 * presented as the more common of the two.
 */
export function provisioningKind(
  record: ProjectionRecord,
): ProvisioningKind | null {
  if (record.aggregateType === "provider_operation")
    return "provider_operation";
  if (record.aggregateType === "termination") return "termination";
  if (record.recordKey.startsWith("provider_operation-"))
    return "provider_operation";
  if (record.recordKey.startsWith("termination-")) return "termination";
  return null;
}

export function provisioningWorkFromProjection(
  record: ProjectionRecord,
): ProvisioningWork {
  const data = record.data;
  const state = authoritative(record);
  const kind = provisioningKind(record);
  const owner = text(data, "owner");
  const reference = text(data, "reference") ?? record.recordKey;
  return {
    id: record.recordKey,
    aggregateId: record.aggregateId,
    accountId: record.accountId,
    kind,
    kindLabel: kind ? kindLabels[kind] : "Unclassified provisioning record",
    reference,
    title: text(data, "title") ?? reference,
    description: text(data, "description"),
    status: text(data, "status"),
    statusLabel: text(data, "statusLabel") ?? "Not recorded",
    risk: risk(data),
    attemptCount:
      kind === "provider_operation" ? integer(state, "attemptCount") : null,
    nextAttemptLabel: kind === "provider_operation" ? text(data, "term") : null,
    provider: text(state, "provider"),
    owner: owner && owner !== reference ? owner : null,
    nextAction: text(data, "nextAction"),
    evidence: recordEvidence(record),
    version: record.version,
    updatedAt: record.sourceUpdatedAt,
  };
}

export interface ProvisioningSummary {
  providerOperations: number;
  terminations: number;
  unclassified: number;
  /** Provider operations the materializer already marks as high risk. */
  highRisk: number;
}

export function summarizeProvisioningWork(
  work: readonly ProvisioningWork[],
): ProvisioningSummary {
  return {
    providerOperations: work.filter(
      (item) => item.kind === "provider_operation",
    ).length,
    terminations: work.filter((item) => item.kind === "termination").length,
    unclassified: work.filter((item) => item.kind === null).length,
    highRisk: work.filter((item) => item.risk === "high").length,
  };
}

/**
 * Severity first, then how many attempts have already been spent, then the
 * reference so the order is stable between two reads of the same page.
 */
const riskOrder: Readonly<Record<ProjectionRisk, number>> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function prioritizeProvisioningWork(
  work: readonly ProvisioningWork[],
): readonly ProvisioningWork[] {
  return [...work].sort(
    (left, right) =>
      (left.risk ? riskOrder[left.risk] : 3) -
        (right.risk ? riskOrder[right.risk] : 3) ||
      (right.attemptCount ?? -1) - (left.attemptCount ?? -1) ||
      left.reference.localeCompare(right.reference),
  );
}
