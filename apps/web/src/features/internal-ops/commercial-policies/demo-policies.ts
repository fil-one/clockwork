import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applyChannelPolicyCommand,
  applyPaygOfferCommand,
  channelPolicySnapshot,
  ChannelPolicyCommandSchema,
  ChannelPolicyRecordSchema,
  PaygOfferCommandSchema,
  PaygOfferRecordSchema,
  type ChannelPolicyCommand,
  type ChannelPolicyRecord,
  type PaygOfferCommand,
  type PaygOfferRecord,
} from "@clockwork/domain/core";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

const author = "21000000-0000-4000-8000-000000000010";
const prefix = "commercial-policy-demo:";
function assertDemo() {
  if (!demoDeployIdentityEnabled(process.env))
    throw new Error("DEMO_POLICY_UNAVAILABLE");
}
function seeds(now: string) {
  const base = {
    rowVersion: 2,
    status: "proposed",
    createdBy: author,
    lastEditedBy: author,
    proposedBy: author,
    approvedBy: null,
    decisionReason:
      "Fictional proposal prepared by a different demo finance author.",
    createdAt: now,
    updatedAt: now,
  };
  return {
    payg: PaygOfferRecordSchema.parse({
      ...base,
      id: "61000000-0000-4000-8000-000000000001",
      approvalEvidenceId: null,
      terms: {
        name: "Fictional PAYG review scenario",
        sku: "storage-standard",
        region: "us-east-1",
        version: 1,
        effectiveFrom: now.slice(0, 10),
        sourceUri: "https://example.test/fictional-policy",
        sourceCheckedAt: now,
        sourceDocumentId: "fictional-demo-source",
        owner: "Demo commercial team",
        payg: {
          currency: "USD",
          storageTbMonthMinor: "499",
          monthlyMinimumMinor: "499",
          partialMonthMinimum: "full",
          correctionWindowDays: 90,
          aggregation: "hourly_average_daily_utc",
          egressRateMinor: "0",
          apiRateMinor: "0",
          stripeTaxCode: "txcd_10103000",
          qboIncomeAccount: "4000",
        },
        trial: {
          durationDays: 30,
          gracePeriodDays: 7,
          storageLimitBytes: "1000000000000",
          cumulativeEgressLimitBytes: "2000000000000",
          maximumCounterAgeSeconds: 60,
          egressExhaustion: "disable_all",
        },
      },
    }),
    channel: ChannelPolicyRecordSchema.parse({
      ...base,
      id: "61000000-0000-4000-8000-000000000002",
      approvalEvidence: null,
      terms: {
        version: 1,
        effectiveFrom: now.slice(0, 10),
        selfServeThresholdTb: 100,
        defaultProtectionDays: 90,
        maximumProtectionDays: 90,
        extensionDays: 30,
        maximumExtensions: 2,
        sourceEvidence:
          "Fictional demo channel program; not an approved live commercial policy.",
      },
    }),
  };
}
function records<T extends { id: string }>(
  state: DemoAdapterState,
  kind: string,
  seed: T,
  schema: z.ZodType<T>,
): T[] {
  const found = new Map([[seed.id, seed]]);
  for (const [key, entry] of Object.entries(state.projectionOverrides))
    if (key.startsWith(`${prefix}${kind}:`)) {
      const row = schema.parse(entry.data);
      found.set(row.id, row);
    }
  return [...found.values()];
}
export function currentDemoChannelPolicies(
  state: DemoAdapterState,
  now = new Date().toISOString(),
) {
  return records(
    state,
    "channel",
    seeds(now).channel,
    ChannelPolicyRecordSchema,
  );
}
export function currentDemoChannelPolicy(
  state: DemoAdapterState,
  now = new Date().toISOString(),
) {
  return channelPolicySnapshot(
    currentDemoChannelPolicies(state, now)
      .filter(
        (row) =>
          row.status === "approved" &&
          row.terms.effectiveFrom <= now.slice(0, 10),
      )
      .sort(
        (a, b) =>
          b.terms.effectiveFrom.localeCompare(a.terms.effectiveFrom) ||
          b.terms.version - a.terms.version,
      )[0],
  );
}
export class DemoCommercialPolicyRepository {
  constructor(
    private readonly store: DemoAdapterStateStore = configuredDemoStateStore(),
  ) {}
  async listPayg(now = new Date().toISOString()): Promise<PaygOfferRecord[]> {
    assertDemo();
    return records(
      await this.store.read(),
      "payg",
      seeds(now).payg,
      PaygOfferRecordSchema,
    );
  }
  async listChannel(
    now = new Date().toISOString(),
  ): Promise<ChannelPolicyRecord[]> {
    assertDemo();
    return currentDemoChannelPolicies(await this.store.read(), now);
  }
  async active(now = new Date().toISOString()) {
    assertDemo();
    return currentDemoChannelPolicy(await this.store.read(), now);
  }
  async commandPayg(input: {
    command: PaygOfferCommand;
    userId: string;
    requestId: string;
    now: string;
  }): Promise<PaygOfferRecord> {
    return PaygOfferRecordSchema.parse(await this.mutate("payg", input));
  }
  async commandChannel(input: {
    command: ChannelPolicyCommand;
    userId: string;
    requestId: string;
    now: string;
  }): Promise<ChannelPolicyRecord> {
    return ChannelPolicyRecordSchema.parse(await this.mutate("channel", input));
  }
  private async mutate(
    kind: "payg" | "channel",
    input: { command: unknown; userId: string; requestId: string; now: string },
  ) {
    assertDemo();
    const userId = z.uuid().parse(input.userId),
      now = z.iso.datetime().parse(input.now);
    const id = randomUUID(),
      receiptKey = `${prefix}receipt:${kind}:${userId}:${input.requestId}`;
    const requestHash = createHash("sha256")
      .update(JSON.stringify(input.command))
      .digest("hex");
    let result: PaygOfferRecord | ChannelPolicyRecord | undefined;
    await this.store.update((state) => {
      const receipt = state.projectionOverrides[receiptKey]?.data;
      if (receipt) {
        if (receipt.requestHash !== requestHash)
          throw new Error("DEMO_POLICY_IDEMPOTENCY_CONFLICT");
        result =
          kind === "payg"
            ? PaygOfferRecordSchema.parse(receipt.result)
            : ChannelPolicyRecordSchema.parse(receipt.result);
        return state;
      }
      const base = {
        id,
        rowVersion: 1,
        status: "draft",
        createdBy: userId,
        lastEditedBy: userId,
        proposedBy: null,
        approvedBy: null,
        decisionReason: "",
        createdAt: now,
        updatedAt: now,
      };
      if (kind === "payg") {
        const command = PaygOfferCommandSchema.parse(input.command),
          rows = records(state, kind, seeds(now).payg, PaygOfferRecordSchema);
        if (command.action === "create") {
          if (command.terms.sourceCheckedAt > now)
            throw new Error("PAYG_OFFER_SOURCE_CHECKED_IN_FUTURE");
          result = PaygOfferRecordSchema.parse({
            ...base,
            terms: command.terms,
            approvalEvidenceId: null,
          });
        } else {
          const current = rows.find((row) => row.id === command.id);
          if (!current) throw new Error("PAYG_OFFER_NOT_FOUND");
          result = applyPaygOfferCommand({ current, command, userId, now });
        }
        const next = result;
        if (
          rows.some(
            (row) =>
              row.id !== next.id &&
              row.terms.version === next.terms.version &&
              row.terms.sku === next.terms.sku &&
              row.terms.region === next.terms.region,
          )
        )
          throw new Error("PAYG_OFFER_VERSION_EXISTS");
      } else {
        const command = ChannelPolicyCommandSchema.parse(input.command),
          rows = currentDemoChannelPolicies(state, now);
        if (command.action === "create")
          result = ChannelPolicyRecordSchema.parse({
            ...base,
            terms: command.terms,
            approvalEvidence: null,
          });
        else {
          const current = rows.find((row) => row.id === command.id);
          if (!current) throw new Error("CHANNEL_POLICY_NOT_FOUND");
          result = applyChannelPolicyCommand({ current, command, userId, now });
        }
        const next = result;
        if (
          rows.some(
            (row) =>
              row.id !== next.id &&
              (row.terms.version === next.terms.version ||
                (row.status === "approved" &&
                  next.status === "approved" &&
                  row.terms.effectiveFrom === next.terms.effectiveFrom)),
          )
        )
          throw new Error("CHANNEL_POLICY_VERSION_CONFLICT");
      }
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [`${prefix}${kind}:${result.id}`]: {
            version: result.rowVersion,
            updatedAt: now,
            data: { ...result },
          },
          [receiptKey]: {
            version: 1,
            updatedAt: now,
            data: {
              requestHash,
              result: { ...result },
              simulated: true,
              actorId: userId,
            },
          },
        },
      };
    });
    if (!result) throw new Error("DEMO_POLICY_WRITE_FAILED");
    return result;
  }
}
