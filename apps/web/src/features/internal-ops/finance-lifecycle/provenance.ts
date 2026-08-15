/**
 * Where a surface's rows came from, stated in the four shapes that are true of
 * the internal surfaces rather than as free text.
 *
 * There is deliberately no variant that takes a sentence. Every one of these
 * pages used to print a hand-written freshness line -- "Collections ledger
 * refreshed 3 minutes ago" above five frozen literals -- and a string prop is
 * what made that possible. A caller now has to name a real instant, a real
 * read, or the absence of one.
 */
export type SurfaceProvenance =
  | {
      kind: "projection";
      /** Internal channel the rows were read from. */
      channel: string;
      generatedAt: string;
      stale: boolean;
      pagesRead: number;
      recordCount: number;
    }
  | { kind: "read"; source: string; readAt: string }
  | { kind: "unreadable"; source: string }
  | {
      kind: "unwired";
      /** What would have to exist for this surface to read anything. */
      detail: string;
    };
