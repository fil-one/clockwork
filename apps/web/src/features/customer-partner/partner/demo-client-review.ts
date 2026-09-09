import { demoPartyFor } from "@/src/features/experience-server/demo-artifact-catalog";
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { isStoredQuote } from "./demo-partner-quote";
import type { QuoteSnapshot } from "@clockwork/domain/core";

export const clientReviewKey = (token: string) =>
  `demo-client-review:${createHash("sha256").update(token).digest("hex")}`;
const responseSchema = z
  .object({
    decision: z.enum(["request_order", "request_changes", "decline"]),
    name: z.string().trim().min(2).max(120),
    note: z.string().trim().max(2000),
    authority: z.literal(true),
  })
  .strict();

export function clientReview(
  state: DemoAdapterState,
  token: string,
  now = new Date(),
) {
  if (!/^[a-f0-9]{64}$/u.test(token)) return undefined;
  const share = state.projectionOverrides[clientReviewKey(token)]?.data;
  if (!share || typeof share.quoteId !== "string") return undefined;
  const stored =
    state.projectionOverrides[`demo-partner-quote:${share.quoteId}`]?.data;
  if (!isStoredQuote(stored)) return undefined;
  const snapshot = stored.snapshot as unknown as QuoteSnapshot;
  if (
    snapshot.status !== "issued" ||
    Date.parse(snapshot.expiresAt) <= now.getTime() ||
    share.version !== stored.record.recordVersion ||
    !snapshot.partnerResaleTotal
  )
    return undefined;
  // Deliberately construct a resale-only view. Never spread a quote snapshot here.
  return {
    quoteId: snapshot.id,
    version: snapshot.revision,
    name: stored.record.name,
    sellerName: demoPartyFor(stored.partnerAccountId).legalName,
    lines: snapshot.lines.map((line) => ({
      sku: line.sku,
      region: line.region,
      quantity: line.quantity,
      termMonths: line.termMonths,
    })),
    total: snapshot.partnerResaleTotal,
    expiresAt: snapshot.expiresAt,
    response: (share.response ?? stored.clientResponse) as
      { decision: string; name: string; note: string; at: string } | undefined,
  };
}

export async function recordClientReview(
  token: string,
  body: unknown,
  store: DemoAdapterStateStore = configuredDemoStateStore(),
  now = new Date(),
) {
  const input = responseSchema.parse(body);
  if (input.decision === "request_changes" && input.note.length < 8)
    throw new Error("Describe the changes you need.");
  let result:
    { decision: string; name: string; note: string; at: string } | undefined;
  await store.update((state) => {
    const view = clientReview(state, token, now);
    if (!view)
      throw new Error(
        "This review link has expired or the quote was replaced. Ask your partner for the current quote.",
      );
    const key = clientReviewKey(token);
    const share = state.projectionOverrides[key];
    if (!share) throw new Error("Review link unavailable");
    if (view.response) {
      if (
        view.response.decision !== input.decision ||
        view.response.name !== input.name ||
        view.response.note !== input.note
      )
        throw new Error(
          "A response is already recorded. Contact your partner to change it.",
        );
      result = view.response;
      return state;
    }
    result = { ...input, at: now.toISOString() };
    const quoteKey = `demo-partner-quote:${view.quoteId}`;
    const previous = state.projectionOverrides[quoteKey];
    if (!previous) throw new Error("Quote unavailable");
    const stored = previous.data;
    if (!isStoredQuote(stored)) throw new Error("Quote unavailable");
    return {
      ...state,
      revision: state.revision + 1,
      projectionOverrides: {
        ...state.projectionOverrides,
        [key]: { ...share, data: { ...share.data, response: result } },
        [quoteKey]: {
          ...previous,
          updatedAt: now.toISOString(),
          data: {
            ...stored,
            clientResponse: result,
            record: {
              ...stored.record,
              secondary:
                input.decision === "request_order"
                  ? "Client requested an order · review purchase request"
                  : input.decision === "request_changes"
                    ? "Client requested changes · prepare a revision"
                    : "Client declined the quotation",
            },
          },
        },
      },
    };
  });
  return result;
}
