import { createHash } from "node:crypto";

import type {
  AccountId,
  IdempotencyKey,
  ProviderResult,
} from "@clockwork/contracts";

export type ScreeningReason =
  "registration" | "pre_signature" | "partner_activation" | "periodic_refresh";

export type ScreeningDecision = "clear" | "review" | "blocked";

export interface ScreeningRequest {
  accountId: AccountId;
  legalName: string;
  aliases: readonly string[];
  country: string;
  registrationNumber?: string;
  reason: ScreeningReason;
  idempotencyKey: IdempotencyKey;
}

export interface ScreeningResult {
  decision: ScreeningDecision;
  reference: string;
  screenedAt: string;
  expiresAt: string;
  matchedLists: readonly string[];
  score?: number;
}

export interface DeniedPartyScreeningPort {
  screen(input: ScreeningRequest): Promise<ProviderResult<ScreeningResult>>;
}

export interface ScreeningProviderClient {
  screen(input: {
    legalName: string;
    aliases: readonly string[];
    country: string;
    registrationNumber?: string;
    reason: ScreeningReason;
    externalReference: string;
    idempotencyKey: string;
  }): Promise<{
    id: string;
    decision: ScreeningDecision;
    matchedLists: readonly string[];
    score?: number;
  }>;
}

export class DeniedPartyScreeningAdapter implements DeniedPartyScreeningPort {
  public constructor(
    private readonly client: ScreeningProviderClient,
    private readonly now: () => Date = () => new Date(),
    private readonly refreshDays = 30,
  ) {}

  public async screen(
    input: ScreeningRequest,
  ): Promise<ProviderResult<ScreeningResult>> {
    if (!/^[A-Z]{2}$/.test(input.country))
      return permanent("INVALID_COUNTRY", "ISO alpha-2 country is required");
    try {
      const response = await this.client.screen({
        legalName: input.legalName,
        aliases: input.aliases,
        country: input.country,
        ...(input.registrationNumber
          ? { registrationNumber: input.registrationNumber }
          : {}),
        reason: input.reason,
        externalReference: input.accountId,
        idempotencyKey: input.idempotencyKey,
      });
      const screenedAt = this.now();
      return {
        ok: true,
        value: {
          decision: response.decision,
          reference: response.id,
          screenedAt: screenedAt.toISOString(),
          expiresAt: new Date(
            screenedAt.getTime() + this.refreshDays * 86_400_000,
          ).toISOString(),
          matchedLists: response.matchedLists,
          ...(response.score === undefined ? {} : { score: response.score }),
        },
      };
    } catch (error) {
      return {
        ok: false,
        kind: "transient",
        code: "SCREENING_PROVIDER_ERROR",
        message:
          error instanceof Error ? error.message : "Unknown screening error",
      };
    }
  }
}

export interface FakeScreeningRule {
  nameIncludes: string;
  decision: Exclude<ScreeningDecision, "clear">;
  matchedLists: readonly string[];
  score?: number;
}

export class FakeDeniedPartyScreeningAdapter implements DeniedPartyScreeningPort {
  private readonly results = new Map<
    string,
    { fingerprint: string; result: ScreeningResult }
  >();
  private nextFailure: "transient" | "permanent" | undefined;

  public constructor(
    private readonly rules: readonly FakeScreeningRule[] = [
      {
        nameIncludes: "blocked fixture",
        decision: "blocked",
        matchedLists: ["CLOCKWORK-DENIED-PARTY-FIXTURE"],
        score: 100,
      },
      {
        nameIncludes: "review fixture",
        decision: "review",
        matchedLists: ["CLOCKWORK-POTENTIAL-MATCH-FIXTURE"],
        score: 72,
      },
    ],
    private readonly now: () => Date = () =>
      new Date("2026-07-31T16:00:00.000Z"),
  ) {}

  public failNext(kind: "transient" | "permanent"): void {
    this.nextFailure = kind;
  }

  public screen(
    input: ScreeningRequest,
  ): Promise<ProviderResult<ScreeningResult>> {
    if (this.nextFailure) {
      const kind = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.resolve({
        ok: false,
        kind,
        code: "SCREENING_SIMULATED_FAILURE",
        message: "Simulated screening failure",
        ...(kind === "transient" ? { retryAfterMs: 1_000 } : {}),
      });
    }
    const fingerprint = hash(
      JSON.stringify({
        accountId: input.accountId,
        legalName: input.legalName,
        aliases: input.aliases,
        country: input.country,
        registrationNumber: input.registrationNumber,
        reason: input.reason,
      }),
    );
    const existing = this.results.get(input.idempotencyKey);
    if (existing && existing.fingerprint !== fingerprint)
      return Promise.resolve(
        permanent("IDEMPOTENCY_CONFLICT", "Screening request changed"),
      );
    if (existing)
      return Promise.resolve({
        ok: true,
        value: existing.result,
        duplicate: true,
      });
    const candidateNames = [input.legalName, ...input.aliases].map((item) =>
      item.toLowerCase(),
    );
    const rule = this.rules.find((item) =>
      candidateNames.some((name) =>
        name.includes(item.nameIncludes.toLowerCase()),
      ),
    );
    const screenedAt = this.now();
    const result: ScreeningResult = {
      decision: rule?.decision ?? "clear",
      reference: `screen_fake_${hash(input.idempotencyKey).slice(0, 20)}`,
      screenedAt: screenedAt.toISOString(),
      expiresAt: new Date(screenedAt.getTime() + 30 * 86_400_000).toISOString(),
      matchedLists: rule?.matchedLists ?? [],
      ...(rule?.score === undefined ? {} : { score: rule.score }),
    };
    this.results.set(input.idempotencyKey, { fingerprint, result });
    return Promise.resolve({ ok: true, value: result });
  }
}

export function passesRestrictedPartyGate(
  result: ScreeningResult,
  now: Date = new Date(),
): boolean {
  return (
    result.decision === "clear" && Date.parse(result.expiresAt) > now.getTime()
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}
