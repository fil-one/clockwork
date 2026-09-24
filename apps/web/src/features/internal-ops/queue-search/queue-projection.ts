import type { ProjectionRecord } from "@/src/features/experience-server/model";

import type { QueueItem, QueueRisk, QueueStatus } from "./model";

type Data = Readonly<Record<string, unknown>>;

function text(data: Data, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function nested(data: Data, key: string): Data {
  const value = data[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function risk(data: Data): QueueRisk | null {
  const value = text(data, "risk");
  return value === "low" || value === "medium" || value === "high"
    ? value
    : null;
}

/**
 * Maps the closed public status set onto the four states an operator queue
 * distinguishes. An unrecognized value stays `null` so it is never filtered as
 * though its disposition were known.
 */
function status(data: Data): QueueStatus | null {
  const value = text(data, "status");
  if (value === "blocked") return "blocked";
  if (value === "open" || value === "active") return "open";
  if (value === "complete" || value === "canceled" || value === "paid")
    return "resolved";
  if (value === "pending" || value === "draft" || value === "attention")
    return "pending";
  return null;
}

/** The context lines the source wrote, label and value as supplied. */
function evidence(record: ProjectionRecord) {
  const entries = record.data.context;
  return Array.isArray(entries)
    ? entries.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          return [];
        const item = entry as Data;
        const label = text(item, "label");
        const value = text(item, "value");
        return label && value ? [{ label, value }] : [];
      })
    : [];
}

/** Lower-case machine code, or null. Queue and subject codes arrive this way. */
function code(data: Data, key: string): string | null {
  const value = text(data, key);
  return value ? value.trim().toLocaleLowerCase() : null;
}

/**
 * Presents one operational projection as queue work.
 *
 * The projection payload carries no assignment, policy citation, opened date or
 * cross-record links, so those stay null instead of being filled with a
 * plausible value. `owner` is dropped when it repeats the record's own
 * reference, which is what the canonical presentation supplies when no person
 * is recorded against the case.
 *
 * Queue, subject and action stay the source's codes. The workspace names them
 * in the reader's language; title-casing a code here used to put English
 * ("Legal Review", "Review Exception") in front of every reader.
 */
export function queueItemFromProjection(record: ProjectionRecord): QueueItem {
  const data = record.data;
  const authoritative = nested(data, "authoritative");
  const owner = text(data, "owner");
  const reference = text(data, "reference");
  const queue = code(authoritative, "queue");
  const subject = code(authoritative, "objectType");
  const actions = Array.isArray(data.allowedActions)
    ? data.allowedActions.filter(
        (action): action is string => typeof action === "string",
      )
    : [];
  const statusLabel = text(data, "statusLabel");
  return {
    id: record.recordKey,
    title: text(data, "title") ?? text(data, "name") ?? record.recordKey,
    entity: subject,
    type: queue,
    owner: owner && owner !== reference ? owner : null,
    ownerId: null,
    backup: null,
    backupId: null,
    risk: risk(data),
    status: status(data),
    ...(statusLabel ? { statusLabel } : {}),
    createdAt: null,
    updatedAt: record.sourceUpdatedAt,
    dueAt: text(authoritative, "targetAt"),
    ageDays: null,
    summary: text(data, "description") ?? text(data, "nextAction"),
    policyReason: null,
    policyBasis: null,
    evidence: evidence(record),
    sourceRecord: {
      version: record.version,
      updatedAt: record.sourceUpdatedAt,
      technicalId: record.aggregateId,
    },
    related: [],
    permittedActions: actions,
  };
}
