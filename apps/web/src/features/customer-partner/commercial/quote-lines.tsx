"use client";

import { useTranslations } from "@/src/i18n/client";
import type { MessageId, Translator } from "@/src/i18n";

import styles from "./commercial.module.css";

export interface EditableQuoteLine {
  offerId: string;
  capacity: string;
  termMonths: string;
}
export interface LineOffer {
  id: string;
  label: string;
  priceBookId: string;
  sku: string;
  region: string;
}

/** Why an additional line cannot be sent, and which line (numbered from 2). */
export interface QuoteLineProblem {
  readonly message: MessageId;
  readonly line: number;
}

/**
 * The first additional line that the server would refuse, as facts. The first
 * line of a quote is the main offer, so additional lines are numbered from 2.
 */
export function additionalLineProblem(
  lines: readonly EditableQuoteLine[],
  offers: readonly LineOffer[],
  priceBookId?: string,
): QuoteLineProblem | undefined {
  for (const [index, line] of lines.entries()) {
    const number = index + 2;
    const offer = offers.find((item) => item.id === line.offerId);
    if (!offer || offer.priceBookId !== priceBookId)
      return {
        message: "customer.commercial.lines.problem.offer",
        line: number,
      };
    if (!Number.isFinite(Number(line.capacity)) || Number(line.capacity) < 10)
      return {
        message: "customer.commercial.lines.problem.capacity",
        line: number,
      };
    if (
      !Number.isInteger(Number(line.termMonths)) ||
      Number(line.termMonths) < 1 ||
      Number(line.termMonths) > 60
    )
      return {
        message: "customer.commercial.lines.problem.term",
        line: number,
      };
  }
  return undefined;
}

/** The same check, as the sentence the reader is shown. */
export function validateAdditionalLines(
  lines: readonly EditableQuoteLine[],
  offers: readonly LineOffer[],
  priceBookId: string | undefined,
  t: Translator,
): string | undefined {
  const problem = additionalLineProblem(lines, offers, priceBookId);
  return problem ? t(problem.message, { line: problem.line }) : undefined;
}

export function QuoteLines({
  lines,
  offers,
  priceBookId,
  onChange,
}: {
  lines: readonly EditableQuoteLine[];
  offers: readonly LineOffer[];
  priceBookId?: string;
  onChange: (lines: EditableQuoteLine[]) => void;
}) {
  const t = useTranslations();
  const available = offers.filter((offer) => offer.priceBookId === priceBookId);
  return (
    <section
      className={styles.section}
      aria-label={t("customer.commercial.lines.label")}
    >
      <h3>{t("customer.commercial.lines.title")}</h3>
      <p>{t("customer.commercial.lines.description")}</p>
      {lines.map((line, index) => (
        <fieldset key={index} className={styles.stageFields}>
          <legend>
            {t("customer.commercial.builder.line", { line: index + 2 })}
          </legend>
          <div className={styles.formGrid}>
            <label>
              {t("customer.commercial.lines.offerFor", { line: index + 2 })}
              <select
                value={line.offerId}
                onChange={(event) =>
                  onChange(
                    lines.map((item, i) =>
                      i === index
                        ? { ...item, offerId: event.target.value }
                        : item,
                    ),
                  )
                }
              >
                <option value="">
                  {t("customer.commercial.builder.chooseOffer")}
                </option>
                {available.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("customer.commercial.lines.capacityFor", { line: index + 2 })}
              <input
                type="number"
                min="10"
                value={line.capacity}
                onChange={(event) =>
                  onChange(
                    lines.map((item, i) =>
                      i === index
                        ? { ...item, capacity: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              {t("customer.commercial.lines.termFor", { line: index + 2 })}
              <input
                type="number"
                min="1"
                max="60"
                value={line.termMonths}
                onChange={(event) =>
                  onChange(
                    lines.map((item, i) =>
                      i === index
                        ? { ...item, termMonths: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
          </div>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            {t("customer.commercial.lines.remove", { line: index + 2 })}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className={styles.secondary}
        disabled={!priceBookId || lines.length >= 49}
        onClick={() =>
          onChange([...lines, { offerId: "", capacity: "", termMonths: "12" }])
        }
      >
        {t("customer.commercial.lines.add")}
      </button>
    </section>
  );
}
