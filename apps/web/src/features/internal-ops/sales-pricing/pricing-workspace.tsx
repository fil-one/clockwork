"use client";

import { useState } from "react";

import type { Money } from "@clockwork/contracts";
import { indicativeLinePrice } from "@clockwork/domain/core";
import { Button, Input, Select } from "@clockwork/ui";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import {
  bookMoney,
  formatQuantity,
} from "../administration-safety/price-book-presentation";
import type { IndicativePriceBook } from "./books";
import styles from "./pricing.module.css";

type Outcome =
  | {
      kind: "priced";
      unitPrice: string;
      monthly: string;
      total: string;
      termMonths: number;
      belowMinimum: boolean;
    }
  | { kind: "invalid" };

/**
 * Indicative pricing for sellers: pick a rate, enter a quantity and term, see
 * a monthly figure and a total. It prices in the browser from list prices
 * only, and saves, sends and approves nothing.
 */
export function PricingWorkspace({
  books,
  initialBookId,
}: {
  books: readonly IndicativePriceBook[];
  initialBookId: string;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [bookId, setBookId] = useState(initialBookId);
  const book = books.find(({ id }) => id === bookId) ?? books[0];
  const [rateId, setRateId] = useState(book?.rates[0]?.id ?? "");
  const [quantity, setQuantity] = useState("100");
  const [termMonths, setTermMonths] = useState("12");
  const [discount, setDiscount] = useState("0");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  if (!book) return null;
  const rate = book.rates.find(({ id }) => id === rateId) ?? book.rates[0];
  if (!rate) return null;
  const money = (value: { currency: string; minor: string }) =>
    bookMoney(value, locale);

  function price() {
    if (!rate) return;
    const percent = Number(discount);
    const months = Number(termMonths);
    try {
      const priced = indicativeLinePrice({
        unitPrice: rate.unitPrice as Money,
        minimumQuantity: rate.minimumQuantity,
        quantity: quantity.trim(),
        termMonths: months,
        discountBps: Math.round(percent * 100),
      });
      setOutcome({
        kind: "priced",
        unitPrice: money(priced.unitPrice),
        monthly: money(priced.monthly),
        total: money(priced.total),
        termMonths: months,
        belowMinimum: priced.belowMinimum,
      });
    } catch {
      setOutcome({ kind: "invalid" });
    }
  }

  return (
    <div className={styles.workspace}>
      {books.length > 1 ? (
        <Select
          label={t("operations.sales.pricing.book")}
          fieldClassName={styles.bookPicker ?? ""}
          value={book.id}
          onChange={(event) => {
            const next = books.find(({ id }) => id === event.target.value);
            setBookId(event.target.value);
            setRateId(next?.rates[0]?.id ?? "");
            setOutcome(null);
          }}
          options={books.map((candidate) => ({
            value: candidate.id,
            label: t("operations.sales.pricing.bookOption", {
              name: candidate.name,
              version: String(candidate.version),
              currency: candidate.currency,
            }),
          }))}
        />
      ) : null}
      <p className={styles.source} role="note">
        {t("operations.sales.pricing.source.active", {
          date: book.effectiveLabel,
        })}
      </p>
      <form
        className={styles.calculator}
        onSubmit={(event) => {
          event.preventDefault();
          price();
        }}
      >
        <div className={styles.fields}>
          <Select
            label={t("operations.sales.pricing.rate")}
            value={rate.id}
            onChange={(event) => {
              setRateId(event.target.value);
              setOutcome(null);
            }}
            options={book.rates.map((candidate) => ({
              value: candidate.id,
              label: t("operations.sales.pricing.rateOption", {
                sku: candidate.sku,
                region: candidate.region,
                price: money(candidate.unitPrice),
                unit: candidate.unit,
              }),
            }))}
          />
          <Input
            label={t("operations.sales.pricing.quantity", { unit: rate.unit })}
            help={t("operations.sales.pricing.minimum", {
              minimum: formatQuantity(rate.minimumQuantity, locale),
              unit: rate.unit,
            })}
            inputMode="decimal"
            required
            pattern="[0-9]+(?:\.[0-9]{1,6})?"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <Input
            label={t("operations.sales.pricing.term")}
            type="number"
            min={1}
            max={120}
            step={1}
            required
            value={termMonths}
            onChange={(event) => setTermMonths(event.target.value)}
          />
          <Input
            label={t("operations.sales.pricing.discount")}
            help={t("operations.sales.pricing.discountHelp")}
            type="number"
            min={0}
            max={100}
            step={0.01}
            required
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </div>
        <Button type="submit">{t("operations.sales.pricing.run")}</Button>
        <div className={styles.result} role="status" aria-live="polite">
          {outcome?.kind === "invalid" ? (
            <p>{t("operations.sales.pricing.invalid")}</p>
          ) : outcome ? (
            <>
              <dl className={styles.figures}>
                <div>
                  <dt>{t("operations.sales.pricing.result.monthly")}</dt>
                  <dd>{outcome.monthly}</dd>
                </div>
                <div>
                  <dt>
                    {t("operations.sales.pricing.result.total", {
                      months: String(outcome.termMonths),
                    })}
                  </dt>
                  <dd>{outcome.total}</dd>
                </div>
                <div>
                  <dt>{t("operations.sales.pricing.result.unit")}</dt>
                  <dd>
                    {t("operations.sales.pricing.perUnit", {
                      price: outcome.unitPrice,
                      unit: rate.unit,
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t("operations.sales.pricing.result.overage")}</dt>
                  <dd>
                    {t("operations.sales.pricing.perUnit", {
                      price: money(rate.overageRate),
                      unit: rate.unit,
                    })}
                  </dd>
                </div>
              </dl>
              {outcome.belowMinimum ? (
                <p className={styles.warning}>
                  {t("operations.sales.pricing.belowMinimum", {
                    minimum: formatQuantity(rate.minimumQuantity, locale),
                    unit: rate.unit,
                  })}
                </p>
              ) : null}
              <p className={styles.caveat}>
                {t("operations.sales.pricing.caveat")}
              </p>
            </>
          ) : null}
        </div>
      </form>
    </div>
  );
}
