import type { ProjectionRecord } from "@/src/features/experience-server/model";

/**
 * Builds a projection record in the exact shape `presentation()` writes in
 * `@clockwork/workflows`: display fields at the top level, the aggregate's own
 * allowlisted columns under `authoritative`. Tests that invent a different
 * shape here would pass against a mapper that could never read a real row.
 */
export function projectionRecord(input: {
  recordKey: string;
  aggregateType: string;
  aggregateId: string;
  channel: ProjectionRecord["channel"];
  version?: number;
  sourceUpdatedAt?: string;
  stale?: boolean;
  authoritative?: Readonly<Record<string, unknown>>;
  data?: Readonly<Record<string, unknown>>;
}): ProjectionRecord {
  const sourceUpdatedAt = input.sourceUpdatedAt ?? "2026-08-01T00:00:00.000Z";
  return {
    id: `50000000-0000-4000-8000-${input.aggregateId.slice(-12)}`,
    recordKey: input.recordKey,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    accountId: null,
    audience: "internal",
    channel: input.channel,
    version: input.version ?? 1,
    sourceUpdatedAt,
    projectedAt: sourceUpdatedAt,
    stale: input.stale ?? false,
    data: {
      authoritative: input.authoritative ?? {},
      context: [],
      ...input.data,
    },
  };
}
