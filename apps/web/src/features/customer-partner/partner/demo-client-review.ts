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

/**
 * A refused client response. `code` names the outcome so the review page can
 * word it in the reader's language; the message is English API text.
 */
export class ClientReviewRefusal extends Error {
  public constructor(
    public readonly code:
      | "CHANGES_NOTE_REQUIRED"
      | "REVIEW_LINK_EXPIRED"
      | "RESPONSE_ALREADY_RECORDED"
      | "QUOTE_UNAVAILABLE",
    detail: string,
  ) {
    super(detail);
  }
}

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
    throw new ClientReviewRefusal(
      "CHANGES_NOTE_REQUIRED",
      "Describe the changes you need.", // i18n-exempt: API problem detail; the review page maps the code
    );
  let result:
    { decision: string; name: string; note: string; at: string } | undefined;
  await store.update((state) => {
    const view = clientReview(state, token, now);
    if (!view)
      throw new ClientReviewRefusal(
        "REVIEW_LINK_EXPIRED",
        "This review link has expired or the quote was replaced. Ask your partner for the current quote.", // i18n-exempt: API problem detail; the review page maps the code
      );
    const key = clientReviewKey(token);
    const share = state.projectionOverrides[key];
    if (!share)
      throw new ClientReviewRefusal(
        "REVIEW_LINK_EXPIRED",
        "Review link unavailable", // i18n-exempt: API problem detail; the review page maps the code
      );
    if (view.response) {
      if (
        view.response.decision !== input.decision ||
        view.response.name !== input.name ||
        view.response.note !== input.note
      )
        throw new ClientReviewRefusal(
          "RESPONSE_ALREADY_RECORDED",
          "A response is already recorded. Contact your partner to change it.", // i18n-exempt: API problem detail; the review page maps the code
        );
      result = view.response;
      return state;
    }
    result = { ...input, at: now.toISOString() };
    const quoteKey = `demo-partner-quote:${view.quoteId}`;
    const previous = state.projectionOverrides[quoteKey];
    const stored = previous?.data;
    if (!previous || !isStoredQuote(stored))
      throw new ClientReviewRefusal(
        "QUOTE_UNAVAILABLE",
        "Quote unavailable", // i18n-exempt: API problem detail; the review page maps the code
      );
    return {
      ...state,
      revision: state.revision + 1,
      projectionOverrides: {
        ...state.projectionOverrides,
        [key]: { ...share, data: { ...share.data, response: result } },
        [quoteKey]: {
          ...previous,
          updatedAt: now.toISOString(),
          // The response is the fact; the partner's ledger derives its line
          // from it in the partner's own language.
          data: { ...stored, clientResponse: result },
        },
      },
    };
  });
  return result;
}
