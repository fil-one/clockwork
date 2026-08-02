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

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function evidence(record: ProjectionRecord) {
  const entries = record.data.context;
  const context = Array.isArray(entries)
    ? entries.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          return [];
        const item = entry as Data;
        const label = text(item, "label");
        const value = text(item, "value");
        return label && value ? [{ label, value }] : [];
      })
    : [];
  return [
    ...context,
    {
      label: "Source record",
      value: `Version ${record.version} · updated ${record.sourceUpdatedAt}`,
      technicalId: record.aggregateId,
    },
  ];
}

/**
 * Presents one operational projection as queue work.
 *
 * The projection payload carries no assignment, policy citation, opened date or
 * cross-record links, so those stay null instead of being filled with a
 * plausible value. `owner` is dropped when it repeats the record's own
 * reference, which is what the canonical presentation supplies when no person
 * is recorded against the case.
 */
export function queueItemFromProjection(record: ProjectionRecord): QueueItem {
  const data = record.data;
  const authoritative = nested(data, "authoritative");
  const owner = text(data, "owner");
  const reference = text(data, "reference");
  const queue = text(authoritative, "queue");
  const subject = text(authoritative, "objectType");
  const actions = Array.isArray(data.allowedActions)
    ? data.allowedActions.filter(
        (action): action is string => typeof action === "string",
      )
    : [];
  const statusLabel = text(data, "statusLabel");
  return {
    id: record.recordKey,
    title: text(data, "title") ?? text(data, "name") ?? record.recordKey,
    entity: subject ? titleCase(subject) : null,
    type: queue ? titleCase(queue) : null,
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
    related: [],
    permittedActions: actions.map(titleCase),
  };
}
