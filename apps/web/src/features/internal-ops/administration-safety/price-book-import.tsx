"use client";

import { Table } from "@clockwork/ui";
import { useState } from "react";
import {
  PriceBookImportCommandSchema,
  parsePriceBookExchange,
  PRICE_BOOK_IMPORT_MAX_BYTES,
  type PriceBookExchange,
} from "@clockwork/domain/core";
import type { PriceBookAdministrationRecord } from "@clockwork/db";
import {
  CommerceApiError,
  sendCoreCommand,
} from "@/src/features/contracts/commerce-client";
import { styles } from "./ui";

function displayMoney(value: { currency: string; minor: string }) {
  const minor = BigInt(value.minor);
  return `${value.currency} ${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

export function PriceBookImport({
  books,
  permitted,
  readAt,
  onBusy,
  onImported,
}: {
  books: readonly PriceBookAdministrationRecord[];
  permitted: boolean;
  readAt: string;
  onBusy: (busy: boolean) => void;
  onImported: (id: string) => void;
}) {
  const [document, setDocument] = useState<PriceBookExchange | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [json, setJson] = useState("");
  return (
    <details className={styles.panel}>
      <summary className={styles.panelBody}>
        Import price-book JSON into a new draft
      </summary>
      <div className={styles.panelBody}>
        <p>
          Paste an economics-only v2 export from Download price book (maximum 1
          MiB, 250 rates). Validate and review the preview first. Prices,
          floors, transfer prices, tax/accounting codes and discount rules are
          retained. New identities and fresh approval are required. Provider
          bindings and approval history cannot be imported. Uploaded source
          details are provenance, not verified authority.
        </p>
        <label className={styles.field}>
          Price-book JSON
          <textarea
            aria-label="Price-book JSON"
            rows={8}
            maxLength={PRICE_BOOK_IMPORT_MAX_BYTES}
            disabled={!permitted || pending}
            value={json}
            onChange={(event) => {
              setJson(event.target.value);
              setDocument(null);
              setMessage("");
            }}
          />
        </label>
        <button
          type="button"
          className={styles.buttonSecondary}
          disabled={!permitted || pending || !json}
          onClick={() => {
            try {
              const parsed = parsePriceBookExchange(json);
              setDocument(parsed);
              setMessage(
                "Validated economics. Review the rates and target draft before importing.",
              );
            } catch (error) {
              setDocument(null);
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Invalid price-book JSON",
              );
            }
          }}
        >
          Validate import preview
        </button>
        <p className={styles.resultMeta}>
          {new TextEncoder().encode(json).length.toLocaleString()} /{" "}
          {PRICE_BOOK_IMPORT_MAX_BYTES.toLocaleString()} bytes
        </p>
        {message ? <p role="status">{message}</p> : null}
        {document ? (
          <form
            aria-label="Import price book"
            onSubmit={(event) => {
              event.preventDefault();
              if (!permitted || pending) return;
              const values = new FormData(event.currentTarget);
              const parsed = PriceBookImportCommandSchema.safeParse({
                name: values.get("name"),
                version: Number(values.get("version")),
                effectiveFrom: values.get("effectiveFrom"),
                reason: values.get("reason"),
                document,
              });
              if (!parsed.success) {
                setMessage(
                  "Check the new draft name, version, effective date and reason.",
                );
                return;
              }
              if (
                books.some(
                  (book) =>
                    book.currency === document.currency &&
                    book.version === parsed.data.version,
                )
              ) {
                setMessage(
                  `${document.currency} version ${parsed.data.version} already exists. Choose a new version.`,
                );
                return;
              }
              const id = crypto.randomUUID();
              setPending(true);
              onBusy(true);
              void sendCoreCommand({
                resource: "price_books",
                id,
                action: "import",
                payload: parsed.data,
              })
                .then(() => {
                  setDocument(null);
                  setJson("");
                  setMessage(
                    "Draft imported. Review its economics and catalog mappings before requesting fresh approval.",
                  );
                  onImported(id);
                })
                .catch((error: unknown) =>
                  setMessage(
                    error instanceof CommerceApiError
                      ? error.problemCode === "DUPLICATE"
                        ? "The destination identity or currency/version already exists. Choose a new version."
                        : error.message
                      : "Import failed. Refresh and check the document and destination version.",
                  ),
                )
                .finally(() => {
                  setPending(false);
                  onBusy(false);
                });
            }}
          >
            <h3>
              Import preview · {document.currency} · {document.rateCards.length}{" "}
              rates
            </h3>
            <p>
              Uploaded source: {document.source.name} v{document.source.version}
              . Discount ceiling:{" "}
              {document.discountMatrix?.defaultMaxDiscountBps ?? 0} bps;{" "}
              {document.discountMatrix?.rules.length ?? 0} scoped rules.
            </p>
            <Table
              caption="Imported rate preview"
              headers={[
                "SKU / region",
                "Unit",
                "List / floor / overage",
                "Minimum / trial limit",
                "Transfer tiers",
                "Tax / accounting",
              ]}
              rows={document.rateCards.map((rate) => [
                `${rate.sku} / ${rate.region}`,
                `${rate.unit} · ${rate.commitType}`,
                `${displayMoney(rate.unitPrice)} / ${rate.floorPrice ? displayMoney(rate.floorPrice) : "Unconfigured"} / ${displayMoney(rate.overageRate)}`,
                `${rate.minimumQuantity} / ${rate.trialLimit ?? "None"}`,
                Object.entries(rate.partnerTransferPrices)
                  .map(([tier, price]) => `${tier}: ${displayMoney(price)}`)
                  .join(", ") || "None",
                `${rate.stripeTaxCode} / ${rate.qboIncomeAccount}`,
              ])}
            />
            <details>
              <summary>Complete validated economics</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(document, null, 2)}
              </pre>
            </details>
            <fieldset
              className={styles.formGrid}
              disabled={!permitted || pending}
            >
              <legend>New draft · approval not requested</legend>
              <label className={styles.field}>
                Imported price-book name
                <input
                  name="name"
                  required
                  minLength={3}
                  maxLength={120}
                  defaultValue={document.source.name}
                />
              </label>
              <label className={styles.field}>
                Imported price-book version
                <input
                  name="version"
                  required
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  defaultValue={
                    Math.max(
                      0,
                      ...books
                        .filter((book) => book.currency === document.currency)
                        .map((book) => book.version),
                    ) + 1
                  }
                />
              </label>
              <label className={styles.field}>
                Imported effective date
                <input
                  name="effectiveFrom"
                  type="date"
                  required
                  defaultValue={readAt.slice(0, 10)}
                />
              </label>
              <label className={styles.field}>
                Import reason
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={1000}
                />
              </label>
              <button type="submit" className={styles.button}>
                {pending ? "Importing…" : "Create imported draft"}
              </button>
            </fieldset>
          </form>
        ) : null}
      </div>
    </details>
  );
}
