import "server-only";

import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";

import type { QueueItem } from "./model";
import { queueItemFromProjection } from "./queue-projection";
import {
  searchRecordFromProjection,
  SEARCHABLE_CHANNELS,
  type SearchableChannel,
  type SearchRecord,
} from "./search-model";

export interface QueueWorkspaceData {
  items: readonly QueueItem[];
  generatedAt: string;
  stale: boolean;
}

/** Reads every authorized queue projection page; no fixture ever backfills it. */
export async function loadQueueWorkspace(): Promise<QueueWorkspaceData> {
  const projection = await loadPortalRecords("internal", "queues");
  return {
    items: projection.records.map(queueItemFromProjection),
    generatedAt: projection.generatedAt,
    stale: projection.stale,
  };
}

/**
 * Operator search reads the same session-scoped projections as every other
 * internal surface, so a record the operator cannot open never appears here.
 */
export async function loadSearchRecords(): Promise<readonly SearchRecord[]> {
  const channels = Object.keys(SEARCHABLE_CHANNELS) as SearchableChannel[];
  const pages = await Promise.all(
    channels.map((channel) => loadPortalRecords("internal", channel)),
  );
  return pages.flatMap((page, index) => {
    const group = SEARCHABLE_CHANNELS[channels[index] as SearchableChannel];
    return page.records.map((record) =>
      searchRecordFromProjection(record, group),
    );
  });
}
