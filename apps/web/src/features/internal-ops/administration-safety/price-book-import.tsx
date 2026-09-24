"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { Translator } from "@/src/i18n";

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
import { discountMatrixSummary, transferPriceList } from "./price-book-diff";
import {
  bookMoney,
  commerceErrorText,
  commitTypeLabel,
  formatQuantity,
  unitLabel,
} from "./price-book-presentation";
import { styles } from "./ui";

/**
 * Why a pasted document was refused, for the reader.
 *
 * The domain parser throws English: a `SyntaxError` from `JSON.parse`, a
 * schema error listing the failing fields, or its own sentence. The first two
 * get a translated sentence; the schema's field paths and messages are quoted
 * as detail because they name what to fix.
 */
function importProblem(error: unknown, t: Translator): string {
  if (error instanceof SyntaxError) return t("adminPricing.import.invalidJson");
  if (
    error instanceof Error &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    const detail = (
      error.issues as readonly { path?: readonly unknown[]; message?: string }[]
    )
      .slice(0, 3)
      .map((issue) =>
        [issue.path?.map(String).join("."), issue.message]
          .filter(Boolean)
          .join(": "),
      )
      .join("; ");
    return t("adminPricing.import.invalidDocument", { detail });
  }
  return error instanceof Error
    ? t("adminPricing.import.invalidDocument", { detail: error.message })
    : t("adminPricing.import.invalidJson");
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
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const [document, setDocument] = useState<PriceBookExchange | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [json, setJson] = useState("");
  const bytes = new TextEncoder().encode(json).length;
  return (
    <details className={styles.panel}>
      <summary className={styles.panelBody}>
        {t("adminPricing.import.summary")}
      </summary>
      <div className={styles.panelBody}>
        <p>{t("adminPricing.import.intro")}</p>
        <label className={styles.field}>
          {t("adminPricing.import.jsonLabel")}
          <textarea
            aria-label={t("adminPricing.import.jsonLabel")}
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
            if (bytes > PRICE_BOOK_IMPORT_MAX_BYTES) {
              setDocument(null);
              setMessage(t("adminPricing.import.tooLarge"));
              return;
            }
            try {
              const parsed = parsePriceBookExchange(json);
              setDocument(parsed);
              setMessage(t("adminPricing.import.validated"));
            } catch (error) {
              setDocument(null);
              setMessage(importProblem(error, t));
            }
          }}
        >
          {t("adminPricing.import.validate")}
        </button>
        <p className={styles.resultMeta}>
          {t("adminPricing.import.bytes", {
            used: new Intl.NumberFormat(formattingLocale).format(bytes),
            count: PRICE_BOOK_IMPORT_MAX_BYTES,
          })}
        </p>
        {message ? <p role="status">{message}</p> : null}
        {document ? (
          <form
            aria-label={t("adminPricing.import.formLabel")}
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
                setMessage(t("adminPricing.import.checkDraft"));
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
                  t("adminPricing.import.versionExists", {
                    currency: document.currency,
                    version: parsed.data.version,
                  }),
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
                  setMessage(t("adminPricing.import.imported"));
                  onImported(id);
                })
                .catch((error: unknown) =>
                  setMessage(
                    error instanceof CommerceApiError &&
                      error.problemCode === "DUPLICATE"
                      ? t("adminPricing.import.duplicate")
                      : commerceErrorText(
                          error,
                          t,
                          "adminPricing.import.failed",
                        ),
                  ),
                )
                .finally(() => {
                  setPending(false);
                  onBusy(false);
                });
            }}
          >
            <h3>
              {t("adminPricing.import.previewTitle", {
                currency: document.currency,
                count: document.rateCards.length,
              })}
            </h3>
            <p>
              {t("common.join.sentences", {
                first: t("adminPricing.import.source", {
                  book: t("adminPricing.bookName", {
                    name: document.source.name,
                    version: document.source.version,
                  }),
                }),
                second: t("adminPricing.import.discount", {
                  summary: discountMatrixSummary(
                    document.discountMatrix,
                    t,
                    formattingLocale,
                  ),
                }),
              })}
            </p>
            <Table
              caption={t("adminPricing.import.tableCaption")}
              headers={[
                t("adminPricing.import.header.skuRegion"),
                t("adminPricing.import.header.unit"),
                t("adminPricing.import.header.prices"),
                t("adminPricing.import.header.minimum"),
                t("adminPricing.rate.transferPrices"),
                t("adminPricing.import.header.tax"),
              ]}
              rows={document.rateCards.map((rate) => [
                `${rate.sku} / ${rate.region}`,
                t("common.join.labels", {
                  first: unitLabel(rate.unit, t),
                  second: commitTypeLabel(rate.commitType, t),
                }),
                [
                  bookMoney(rate.unitPrice, formattingLocale),
                  rate.floorPrice
                    ? bookMoney(rate.floorPrice, formattingLocale)
                    : t("adminPricing.rate.notConfigured"),
                  bookMoney(rate.overageRate, formattingLocale),
                ].join(" / "),
                [
                  formatQuantity(rate.minimumQuantity, formattingLocale),
                  rate.trialLimit
                    ? formatQuantity(rate.trialLimit, formattingLocale)
                    : t("common.none"),
                ].join(" / "),
                transferPriceList(
                  Object.entries(rate.partnerTransferPrices).map(
                    ([tier, value]) => ({ tier, value }),
                  ),
                  t,
                  formattingLocale,
                ),
                `${rate.stripeTaxCode} / ${rate.qboIncomeAccount}`,
              ])}
            />
            <details>
              <summary>{t("adminPricing.import.completeEconomics")}</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(document, null, 2)}
              </pre>
            </details>
            <fieldset
              className={styles.formGrid}
              disabled={!permitted || pending}
            >
              <legend>{t("adminPricing.import.legend")}</legend>
              <label className={styles.field}>
                {t("adminPricing.import.name")}
                <input
                  name="name"
                  required
                  minLength={3}
                  maxLength={120}
                  defaultValue={document.source.name}
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.import.version")}
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
                {t("adminPricing.import.effectiveFrom")}
                <input
                  name="effectiveFrom"
                  type="date"
                  required
                  defaultValue={readAt.slice(0, 10)}
                />
              </label>
              <label className={styles.field}>
                {t("adminPricing.import.reason")}
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={1000}
                />
              </label>
              <button type="submit" className={styles.button}>
                {pending
                  ? t("adminPricing.import.importing")
                  : t("adminPricing.import.submit")}
              </button>
            </fieldset>
          </form>
        ) : null}
      </div>
    </details>
  );
}
