import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionClaims } from "@clockwork/api";
import { uuidV7 } from "@clockwork/contracts";
import { issueQuote, type QuoteSnapshot } from "@clockwork/domain/core";
import {
  CommercialArtifactDefinitionSchema,
  commercialArtifactSourceHash,
} from "@clockwork/db/core";
import type { DemoAdapterStateStore } from "@clockwork/testing/demo-state";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { commercialArtifactSource } from "@/src/features/experience-server/artifact-sources";
import {
  demoPartyFor,
  demoUuid,
  demoPlatformIssuer,
} from "@/src/features/experience-server/demo-artifact-catalog";
import type {
  DemoQuoteState,
  DemoQuoteCommercialArtifactRequest,
} from "@/src/features/experience-server/demo-quote-flow";
import { isStoredQuote } from "./demo-partner-quote";

const schema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  action: z.enum(["prepare_artifact", "issue"]),
  payload: z.record(z.string(), z.unknown()),
});
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}
const money = (value: { currency: string; minor: string }) => ({
  currency: value.currency,
  minorUnits: value.minor,
});

export async function handlePartnerLifecycle(
  body: unknown,
  session: SessionClaims,
  key: string,
  requestHash: string,
  input: { store?: DemoAdapterStateStore; now?: string },
): Promise<Response> {
  try {
    const command = schema.parse(body);
    const store = input.store ?? configuredDemoStateStore();
    const now = input.now ?? new Date().toISOString();
    let result: unknown;
    await store.update((current) => {
      const state = current as DemoQuoteState;
      const receiptKey = `partner-lifecycle:${createHash("sha256")
        .update(session.userId + key)
        .digest("hex")}`;
      const receipt = state.projectionOverrides[receiptKey]?.data;
      if (receipt) {
        if (receipt.requestHash !== requestHash)
          throw new Refusal(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Retry key belongs to a different request.",
          );
        result = receipt.response;
        return state;
      }
      const storageKey = `demo-partner-quote:${command.id}`;
      const stored = state.projectionOverrides[storageKey]?.data;
      if (
        !isStoredQuote(stored) ||
        !session.accountIds.includes(stored.partnerAccountId) ||
        stored.snapshot.accountId !== command.accountId
      )
        throw new Refusal(
          403,
          "PARTNER_QUOTE_SCOPE_FORBIDDEN",
          "This quote is outside your partner account.",
        );
      const snapshot = stored.snapshot as unknown as QuoteSnapshot;
      if ((stored.record.recordVersion ?? 1) !== command.expectedVersion)
        throw new Refusal(
          409,
          "VERSION_CONFLICT",
          "The quote changed. Reload its details.",
        );
      if (snapshot.status !== "draft")
        throw new Refusal(422, "INVALID_STATE", "Only a draft can be issued.");
      if (Date.parse(snapshot.expiresAt) <= Date.parse(now))
        throw new Refusal(
          422,
          "QUOTE_EXPIRED",
          "The quote has expired. Create a new quote with current terms.",
        );
      if (["exception_required", "rejected"].includes(snapshot.marginResult))
        throw new Refusal(
          422,
          "PRICING_REVIEW_REQUIRED",
          "Pricing approval is required before issuance.",
        );
      let requests = { ...state.commercialArtifactRequests };
      let updated = stored;
      let data: Record<string, unknown>;
      if (command.action === "prepare_artifact") {
        const audience = z
          .enum(["partner", "end_client"])
          .parse(command.payload.audience);
        const issuedAt = z.iso.datetime().parse(command.payload.issuedAt);
        const retainUntil = z.iso.datetime().parse(command.payload.retainUntil);
        if (Date.parse(retainUntil) <= Date.parse(issuedAt))
          throw new Refusal(
            422,
            "INVALID_RETENTION",
            "Document retention must follow issuance.",
          );
        const transfer = audience === "partner";
        const kind = transfer
          ? "partner_transfer_quote"
          : "partner_resale_quote";
        const total = transfer ? snapshot.total : snapshot.partnerResaleTotal;
        if (!total)
          throw new Refusal(
            422,
            "RESALE_PRICE_REQUIRED",
            "This quote has no resale price.",
          );
        const definition = CommercialArtifactDefinitionSchema.parse({
          kind,
          displayDocumentId: `PQ-${snapshot.id}-R${snapshot.revision}-${audience}`,
          documentVersion: String(snapshot.revision),
          issuedAt,
          locale: "en-GB",
          recipient: demoPartyFor(
            transfer ? stored.partnerAccountId : snapshot.accountId,
          ),
          issuerMode: transfer ? "platform" : "partner",
          ...(!transfer
            ? { partnerIssuer: demoPartyFor(stored.partnerAccountId) }
            : {}),
          quoteNumber: `PQ-${snapshot.id}-R${snapshot.revision}`,
          validUntil: snapshot.expiresAt.slice(0, 10),
          currency: total.currency,
          lineItems: transfer
            ? snapshot.lines.map((line) => ({
                id: line.id,
                description: line.sku,
                detail: `${line.region} · ${line.termMonths} months`,
                quantity: line.quantity,
                unitLabel: line.unit,
                unitPrice: money(line.unitPrice),
                amount: money(line.lineTotal),
              }))
            : [
                {
                  id: snapshot.id,
                  description: "Contracted storage capacity",
                  detail: snapshot.lines
                    .map(
                      (line) =>
                        `${line.quantity} ${line.unit} · ${line.sku} · ${line.region} · ${line.termMonths} months`,
                    )
                    .join("; "),
                  quantity: "1",
                  unitLabel: "commitment",
                  unitPrice: money(total),
                  amount: money(total),
                },
              ],
          totals: { subtotal: money(total), total: money(total) },
          paymentTerms: "Net 30 days",
          commercialTerms: transfer
            ? [
                "Confidential transfer pricing. Do not share this document with the end client.",
                "The partner is merchant of record to the end client.",
              ]
            : [
                "The issuing partner is merchant of record. Contact the partner for purchase and billing arrangements.",
              ],
          notes: ["Demonstration quotation. Not a real commercial offer."],
        });
        const sourceHash = commercialArtifactSourceHash(definition);
        const id = demoUuid(
          `partner-quote-artifact:${snapshot.id}:${kind}:${sourceHash}`,
        );
        const request: DemoQuoteCommercialArtifactRequest = {
          id,
          documentId: demoUuid(`partner-quote-document:${id}`),
          subjectType: "quote",
          subjectId: snapshot.id,
          commercialAccountId: snapshot.accountId,
          audienceAccountId: stored.partnerAccountId,
          audience: "partner",
          documentKind: kind,
          sourceHash,
          definition,
          retainUntil,
          requestedBy: session.userId,
          createdAt: now,
        };
        requests = { ...requests, [id]: request };
        data = {
          artifactRequest: { requestId: id, documentId: request.documentId },
        };
      } else {
        const issuedAt = z.iso
          .datetime()
          .parse(command.payload.artifactIssuedAt);
        const transferId = z.uuid().parse(command.payload.renderedDocumentId);
        const resaleId = z.uuid().parse(command.payload.partnerDocumentId);
        const documents = (
          [
            ["partner_transfer_quote", transferId],
            ["partner_resale_quote", resaleId],
          ] as const
        ).map(([kind, id]) => {
          const request = Object.values(requests).find(
            (candidate) =>
              candidate.documentId === id &&
              candidate.subjectId === snapshot.id &&
              candidate.documentKind === kind &&
              candidate.audienceAccountId === stored.partnerAccountId,
          );
          const delivery = request && state.artifactDeliveries?.[request.id];
          if (
            !request ||
            request.definition.issuedAt !== issuedAt ||
            !delivery ||
            delivery.documentId !== id ||
            delivery.kind !== kind ||
            delivery.subjectId !== snapshot.id ||
            delivery.accountId !== stored.partnerAccountId ||
            delivery.sourceHash !==
              commercialArtifactSource({
                subjectType: "quote",
                subjectId: snapshot.id,
                audienceAccountId: stored.partnerAccountId,
                audience: "partner",
                kind,
                definition: request.definition,
                sourceHash: request.sourceHash,
                retainUntil: request.retainUntil,
                issuer: demoPlatformIssuer,
              }).sourceHash
          )
            throw new Refusal(
              422,
              "DOCUMENT_NOT_READY",
              "Both documents must be rendered for this exact quote before issuance.",
            );
          return {
            id: request.id,
            kind,
            label:
              kind === "partner_transfer_quote"
                ? "Confidential transfer quote"
                : "End-client quotation",
          };
        });
        const issued = issueQuote(snapshot, {
          issuedAt,
          renderedDocumentId: transferId,
          partnerDocumentId: resaleId,
        });
        updated = {
          ...stored,
          snapshot: issued as unknown as Record<string, unknown>,
          record: {
            ...stored.record,
            status: "open",
            recordVersion: command.expectedVersion + 1,
            secondary: `Issued · expires ${snapshot.expiresAt.slice(0, 10)}`,
            allowedActions: ["download"],
            documents,
          },
        };
        data = { status: "issued" };
      }
      result = {
        record: {
          id: command.id,
          accountId: command.accountId,
          resource: "quotes",
          rowVersion: updated.record.recordVersion ?? 1,
          data,
        },
        auditEventId: uuidV7(),
        outboxMessageId: uuidV7(),
      };
      return {
        ...state,
        revision: state.revision + 1,
        commercialArtifactRequests: requests,
        projectionOverrides: {
          ...state.projectionOverrides,
          [storageKey]: {
            version: updated.record.recordVersion ?? 1,
            updatedAt: now,
            data: updated,
          },
          [receiptKey]: {
            version: 1,
            updatedAt: now,
            data: { requestHash, response: result },
          },
        },
      };
    });
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const status =
      error instanceof Refusal
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : 500;
    return Response.json(
      {
        status,
        code: error instanceof Refusal ? error.code : "PARTNER_DOCUMENT_FAILED",
        detail:
          error instanceof Refusal
            ? error.message
            : "The partner documents could not be prepared. Reload and retry.",
      },
      { status },
    );
  }
}
