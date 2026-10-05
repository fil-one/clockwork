"use client";

import { useId, useState } from "react";

import { useTranslations } from "@/src/i18n/client";

import {
  PriceBookSimulation,
  type SimulatedPriceBook,
} from "../administration-safety/price-book-discounts";
import styles from "./pricing.module.css";

/** A price book as the sales workspace prices with it. */
export interface IndicativePriceBook extends SimulatedPriceBook {
  status: "active" | "draft";
  /** The effective date, already written for the reader. */
  effectiveLabel: string;
}

/**
 * Indicative pricing for sellers: pick a book, price a line. Nothing here is
 * saved, sent or approved, and the source of every figure is stated above it.
 */
export function PricingWorkspace({
  books,
  initialBookId,
}: {
  books: readonly IndicativePriceBook[];
  initialBookId: string;
}) {
  const t = useTranslations();
  const selectId = useId();
  const [selectedId, setSelectedId] = useState(initialBookId);
  const book = books.find(({ id }) => id === selectedId) ?? books[0];
  if (!book) return null;
  return (
    <div className={styles.workspace}>
      {books.length > 1 ? (
        <div className={styles.bookPicker}>
          <label htmlFor={selectId}>{t("operations.sales.pricing.book")}</label>
          <select
            id={selectId}
            value={book.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {books.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {t("operations.sales.pricing.bookOption", {
                  name: candidate.name,
                  version: String(candidate.version),
                  currency: candidate.currency,
                })}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <p
        className={styles.source}
        data-tone={book.status === "draft" ? "warning" : undefined}
        role="note"
      >
        {book.status === "active"
          ? t("operations.sales.pricing.source.active", {
              date: book.effectiveLabel,
            })
          : t("operations.sales.pricing.source.draft")}
      </p>
      <div className={styles.calculator}>
        {/* Keyed so switching books clears the previous book's result. */}
        <PriceBookSimulation key={book.id} book={book} />
      </div>
    </div>
  );
}
