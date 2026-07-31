import type { AccountId, ProviderResult } from "@clockwork/contracts";

export interface SupportSignal {
  externalId: string;
  accountId: AccountId;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  summary: string;
  openedAt: string;
  updatedAt: string;
  status: "open" | "pending" | "resolved";
}

/** Deliberately read-only: support intake remains in the existing support channel. */
export interface ReadOnlySupportFeedPort {
  listSignals(input: {
    accountId: AccountId;
    since?: string;
    cursor?: string;
    limit?: number;
  }): Promise<
    ProviderResult<{
      items: readonly SupportSignal[];
      nextCursor: string | null;
    }>
  >;
}

export interface SupportProviderClient {
  listSignals(input: {
    externalAccountId: string;
    since?: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: readonly Omit<SupportSignal, "accountId">[];
    nextCursor: string | null;
  }>;
}

export class ReadOnlySupportFeedAdapter implements ReadOnlySupportFeedPort {
  public constructor(private readonly client: SupportProviderClient) {}

  public async listSignals(
    input: Parameters<ReadOnlySupportFeedPort["listSignals"]>[0],
  ): ReturnType<ReadOnlySupportFeedPort["listSignals"]> {
    const limit = input.limit ?? 50;
    if (limit < 1 || limit > 100)
      return permanent(
        "INVALID_LIMIT",
        "Support feed limit must be 1 through 100",
      );
    try {
      const response = await this.client.listSignals({
        externalAccountId: input.accountId,
        ...(input.since ? { since: input.since } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit,
      });
      return {
        ok: true,
        value: {
          items: response.items.map((item) => ({
            ...item,
            accountId: input.accountId,
          })),
          nextCursor: response.nextCursor,
        },
      };
    } catch (error) {
      return {
        ok: false,
        kind: "transient",
        code: "SUPPORT_PROVIDER_ERROR",
        message:
          error instanceof Error ? error.message : "Unknown support error",
      };
    }
  }
}

export class FakeReadOnlySupportFeed implements ReadOnlySupportFeedPort {
  private readonly signals: SupportSignal[] = [];
  private nextFailure: "transient" | "permanent" | undefined;

  public seed(...signals: SupportSignal[]): void {
    this.signals.push(...signals);
  }

  public failNext(kind: "transient" | "permanent"): void {
    this.nextFailure = kind;
  }

  public listSignals(
    input: Parameters<ReadOnlySupportFeedPort["listSignals"]>[0],
  ): ReturnType<ReadOnlySupportFeedPort["listSignals"]> {
    if (this.nextFailure) {
      const kind = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.resolve({
        ok: false,
        kind,
        code: "SUPPORT_SIMULATED_FAILURE",
        message: "Simulated support feed failure",
        ...(kind === "transient" ? { retryAfterMs: 1_000 } : {}),
      });
    }
    const limit = Math.min(input.limit ?? 50, 100);
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const matching = this.signals
      .filter((item) => item.accountId === input.accountId)
      .filter((item) => !input.since || item.updatedAt >= input.since)
      .sort((left, right) =>
        `${right.updatedAt}:${right.externalId}`.localeCompare(
          `${left.updatedAt}:${left.externalId}`,
        ),
      );
    const items = matching.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return Promise.resolve({
      ok: true,
      value: {
        items,
        nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
      },
    });
  }
}

function permanent(
  code: string,
  message: string,
): Promise<ProviderResult<never>> {
  return Promise.resolve({ ok: false, kind: "permanent", code, message });
}
