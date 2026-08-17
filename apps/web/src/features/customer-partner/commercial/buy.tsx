"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";
import { CapacityMeter } from "@clockwork/ui";

import {
  CommerceApiError,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";

import { commercialArtifactRetainUntil } from "./artifact-retention";
import {
  buildBuyQuoteCommand,
  buyCapacity,
  initialBuyDraft,
  needsFullQuote,
  quoteHandoff,
  requiresPricingReview,
  SELF_SERVE_CAPACITY_CEILING_TB,
  SELF_SERVE_TERM_MONTHS,
  serverPrice,
  type BuyDraft,
  type ServerPrice,
} from "./buy-model";
import styles from "./buy.module.css";
import type {
  LookupBuyQuoteProjection,
  LookupPreparedQuoteArtifact,
} from "./prepared-quote-artifact";
import type { QuoteOfferOption } from "./workflow-model";

export type BuyMode = "authoritative" | "demo";

type BuyPhase =
  "configure" | "working" | "demo_draft" | "pricing_review" | "ready" | "error";

const defaultPollAttempts = 15;
const defaultPollIntervalMs = 1_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function pricingException(error: unknown): boolean {
  return (
    error instanceof CommerceApiError &&
    error.status === 422 &&
    /pricing exception|margin/i.test(error.message)
  );
}

export function SelfServeBuy({
  account,
  catalogueMode,
  lookupArtifact,
  lookupProjection,
  mode,
  offers,
  pollAttempts = defaultPollAttempts,
  pollIntervalMs = defaultPollIntervalMs,
}: {
  account: { id: string; name: string };
  catalogueMode: "authoritative" | "simulated";
  lookupArtifact: LookupPreparedQuoteArtifact;
  lookupProjection: LookupBuyQuoteProjection;
  mode: BuyMode;
  offers: readonly QuoteOfferOption[];
  pollAttempts?: number;
  pollIntervalMs?: number;
}) {
  const [draft, setDraft] = useState<BuyDraft>(() => initialBuyDraft(offers));
  const [phase, setPhase] = useState<BuyPhase>("configure");
  const [message, setMessage] = useState("");
  const [price, setPrice] = useState<ServerPrice | null>(null);
  const quoteIdRef = useRef<string | null>(null);
  const createKeyRef = useRef<string | null>(null);
  const prepareKeyRef = useRef<string | null>(null);
  const issueKeyRef = useRef<string | null>(null);
  const issuedAtRef = useRef<string | null>(null);
  const commandRef = useRef<ReturnType<typeof buildBuyQuoteCommand> | null>(
    null,
  );

  const capacity = buyCapacity(draft);
  const fullQuote = needsFullQuote(draft);
  const quoteId = quoteIdRef.current;

  const resetRun = () => {
    quoteIdRef.current = null;
    createKeyRef.current = null;
    prepareKeyRef.current = null;
    issueKeyRef.current = null;
    issuedAtRef.current = null;
    commandRef.current = null;
    setPhase("configure");
    setMessage("");
    setPrice(null);
  };

  const update = (field: keyof BuyDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    resetRun();
  };

  const waitForArtifact = async (quoteIdValue: string) => {
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const result = await lookupArtifact(quoteIdValue);
      if (result.status === "stored") return result;
      if (result.status === "forbidden")
        throw new Error("Your session can no longer prepare this quote.");
      if (result.status === "unavailable")
        throw new Error(
          "This workspace cannot confirm that the quote document was stored.",
        );
      if (attempt + 1 < pollAttempts) await delay(pollIntervalMs);
    }
    throw new Error(
      "The quote document is still rendering. Try again to continue this same draft.",
    );
  };

  const waitForIssuedProjection = async (quoteIdValue: string) => {
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const result = await lookupProjection(quoteIdValue);
      if (result.status === "found" && result.quoteStatus === "issued")
        return result;
      if (result.status === "forbidden")
        throw new Error("Your session can no longer read this quote.");
      if (result.status === "unavailable")
        throw new Error(
          "This workspace cannot confirm the new quote in the customer ledger.",
        );
      if (attempt + 1 < pollAttempts) await delay(pollIntervalMs);
    }
    throw new Error(
      "The quote was issued, but it is not in the customer ledger yet. Try again before continuing to acceptance.",
    );
  };

  const run = async () => {
    setPhase("working");
    setMessage("");
    try {
      quoteIdRef.current ??= uuidV7();
      commandRef.current ??= buildBuyQuoteCommand({
        draft,
        account: { id: account.id, label: account.name },
        offers,
        quoteId: quoteIdRef.current,
        now: new Date(),
      });
      createKeyRef.current ??= crypto.randomUUID();
      const created = await sendCoreCommand(commandRef.current, {
        idempotencyKey: createKeyRef.current,
      });
      setPrice(catalogueMode === "authoritative" ? serverPrice(created) : null);
      if (mode === "demo") {
        setPhase("demo_draft");
        setMessage(
          "This demo returned a simulated draft-command response. It did not save, price, or issue a quote, so there is no order to accept.",
        );
        return;
      }
      const rowVersion = Number(
        (created as { record?: { rowVersion?: unknown } }).record?.rowVersion,
      );
      if (!Number.isInteger(rowVersion) || rowVersion < 1)
        throw new Error("The priced draft response omitted its version.");
      if (requiresPricingReview(created)) {
        setPhase("pricing_review");
        setMessage(
          "The server saved this priced draft, and it needs pricing review before issuance.",
        );
        return;
      }
      issuedAtRef.current ??= new Date().toISOString();
      prepareKeyRef.current ??= crypto.randomUUID();
      await sendCoreCommand(
        {
          resource: "quotes",
          id: quoteIdRef.current,
          accountId: account.id,
          action: "prepare_artifact",
          expectedVersion: rowVersion,
          payload: {
            audience: "end_client",
            issuedAt: issuedAtRef.current,
            retainUntil: commercialArtifactRetainUntil(issuedAtRef.current),
          },
        },
        { idempotencyKey: prepareKeyRef.current },
      );
      const artifact = await waitForArtifact(quoteIdRef.current);
      issueKeyRef.current ??= crypto.randomUUID();
      try {
        await sendCoreCommand(
          {
            resource: "quotes",
            id: quoteIdRef.current,
            accountId: account.id,
            action: "issue",
            expectedVersion: rowVersion,
            payload: {
              artifactIssuedAt: issuedAtRef.current,
              renderedDocumentId: artifact.documentId,
            },
          },
          { idempotencyKey: issueKeyRef.current },
        );
      } catch (error) {
        if (pricingException(error)) {
          setPhase("pricing_review");
          setMessage(
            "The server saved this priced draft, and it needs pricing review before issuance.",
          );
          return;
        }
        throw error;
      }
      await waitForIssuedProjection(quoteIdRef.current);
      setPhase("ready");
      setMessage(
        "The issued quote is now recorded in the customer ledger and ready for acceptance.",
      );
    } catch (error) {
      setPhase("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The quote could not be completed. Nothing further was changed.",
      );
    }
  };

  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <p className={styles.context}>Customer workspace · Direct purchase</p>
        <h1>Buy storage</h1>
        <p>
          Configure one direct 12-month quote.
          {catalogueMode === "simulated"
            ? " The demo echoes a simulated draft and stops before issuance."
            : " The server prices the draft and issues it only after its customer document is stored and bound."}
        </p>
      </header>

      {catalogueMode === "simulated" ? (
        <p className={styles.rule} role="status">
          Demo catalogue · the offer and draft-command response are simulated.
          No authoritative price book is read and no quote is saved, priced, or
          issued.
        </p>
      ) : null}

      <ol aria-label="Purchase path" className={styles.steps}>
        <li aria-current={phase === "configure" ? "step" : undefined}>
          Configure
        </li>
        <li aria-current={phase === "working" ? "step" : undefined}>
          {catalogueMode === "simulated"
            ? "Simulated draft"
            : "Server price and document"}
        </li>
        <li aria-current={phase === "ready" ? "step" : undefined}>
          Accept order
        </li>
      </ol>

      <div className={styles.layout}>
        <section aria-labelledby="buy-configure" className={styles.panel}>
          <h2 id="buy-configure">Configure the quote</h2>
          <div className={styles.fields}>
            <label>
              Offer
              <select
                disabled={phase === "working"}
                onChange={(event) => update("offerId", event.target.value)}
                value={draft.offerId}
              >
                {offers.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Committed capacity (TB)
              <input
                disabled={phase === "working"}
                inputMode="decimal"
                min="10"
                onChange={(event) => update("capacity", event.target.value)}
                type="number"
                value={draft.capacity}
              />
            </label>
          </div>
          {offers.length === 0 ? (
            <p className={styles.error} role="alert">
              No active offer catalogue is available for this account. No quote
              command can be sent.
            </p>
          ) : null}
          <CapacityMeter
            label="Capacity routing"
            max={150}
            threshold={SELF_SERVE_CAPACITY_CEILING_TB}
            thresholdLabel="100 TB routes to the full quote workspace"
            value={capacity ?? 0}
            valueLabel={capacity === null ? "Not set" : `${capacity} TB`}
          />
          <p className={styles.rule}>
            Self-serve is below 100 TB. The 100 TB line is this page&apos;s
            routing choice, not a pricing rule.
            {catalogueMode === "simulated"
              ? " This demo does not calculate a real price."
              : " Every quote is priced by the server."}
          </p>
          <dl className={styles.terms}>
            <div>
              <dt>Commercial route</dt>
              <dd>
                Direct · Fil One contracts with and invoices this customer
              </dd>
            </div>
            <div>
              <dt>Term</dt>
              <dd>{SELF_SERVE_TERM_MONTHS} months · fixed on this page</dd>
            </div>
          </dl>

          {price ? (
            <p className={styles.price}>
              <span>Server-priced amount</span>
              <strong>{price.display}</strong>
            </p>
          ) : null}

          {message ? (
            <p
              className={phase === "error" ? styles.error : styles.status}
              role={phase === "error" ? "alert" : "status"}
            >
              {message}
            </p>
          ) : null}

          <div className={styles.actions}>
            {fullQuote ? (
              <Link className={styles.primary} href={quoteHandoff(draft)}>
                Continue in a quote
              </Link>
            ) : phase === "ready" && quoteId ? (
              <Link
                className={styles.primary}
                href={`/orders/accept?quote=quote-${quoteId}`}
              >
                Review and accept order
              </Link>
            ) : phase === "pricing_review" && quoteId ? (
              <Link
                className={styles.primary}
                href={`/quotes/quote-${quoteId}`}
              >
                Open priced draft
              </Link>
            ) : phase === "demo_draft" ? null : (
              <button
                className={styles.primary}
                disabled={
                  offers.length === 0 ||
                  capacity === null ||
                  phase === "working"
                }
                onClick={() => void run()}
                type="button"
              >
                {phase === "working"
                  ? "Pricing and preparing…"
                  : phase === "error"
                    ? "Try again"
                    : catalogueMode === "simulated"
                      ? "Simulate draft"
                      : "Price and prepare quote"}
              </button>
            )}
          </div>
        </section>

        <aside aria-labelledby="buy-boundary" className={styles.boundary}>
          <h2 id="buy-boundary">What happens next</h2>
          <p>
            A priced draft is not an order. In authoritative mode the quote must
            be issued, projected to this account, and then explicitly accepted
            with authority and service dates.
          </p>
          <p>
            If a pricing guardrail requires review, the draft remains saved and
            no issued quote or acceptance handoff is claimed.
          </p>
        </aside>
      </div>
    </main>
  );
}
