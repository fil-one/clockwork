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
  const dashboard = pages[channels.indexOf("dashboard")]?.records ?? [];
  const accountKeysByIdentity = new Map<string, string>();
  for (const record of dashboard) {
    accountKeysByIdentity.set(record.aggregateId, record.recordKey);
    for (const key of ["title", "name", "reference"]) {
      const value = record.data[key];
      if (typeof value === "string" && value.trim())
        accountKeysByIdentity.set(
          value.trim().toLocaleLowerCase(),
          record.recordKey,
        );
    }
  }
  const relatedAccountKey = (record: (typeof dashboard)[number]) => {
    if (record.accountId && accountKeysByIdentity.has(record.accountId))
      return accountKeysByIdentity.get(record.accountId);
    const authoritative = record.data.authoritative;
    if (
      authoritative &&
      typeof authoritative === "object" &&
      !Array.isArray(authoritative)
    )
      for (const key of [
        "accountId",
        "invoicingAccountId",
        "billingAccountId",
      ]) {
        const value = (authoritative as Readonly<Record<string, unknown>>)[key];
        if (typeof value === "string" && accountKeysByIdentity.has(value))
          return accountKeysByIdentity.get(value);
      }
    const context = record.data.context;
    if (Array.isArray(context))
      for (const entry of context) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          continue;
        const item = entry as Readonly<Record<string, unknown>>;
        if (item.label !== "Account" || typeof item.value !== "string")
          continue;
        const match = accountKeysByIdentity.get(
          item.value.trim().toLocaleLowerCase(),
        );
        if (match) return match;
      }
    return undefined;
  };
  return pages.flatMap((page, index) => {
    const group = SEARCHABLE_CHANNELS[channels[index] as SearchableChannel];
    return page.records.map((record) =>
      searchRecordFromProjection(record, group, relatedAccountKey(record)),
    );
  });
}
