"use client";

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

export function validateAdditionalLines(
  lines: readonly EditableQuoteLine[],
  offers: readonly LineOffer[],
  priceBookId?: string,
): string | undefined {
  for (const [index, line] of lines.entries()) {
    const offer = offers.find((item) => item.id === line.offerId);
    if (!offer || offer.priceBookId !== priceBookId)
      return `Line ${index + 2}: select an offer from the same price book as the first line.`;
    if (!Number.isFinite(Number(line.capacity)) || Number(line.capacity) < 10)
      return `Line ${index + 2}: enter at least 10 TB.`;
    if (
      !Number.isInteger(Number(line.termMonths)) ||
      Number(line.termMonths) < 1 ||
      Number(line.termMonths) > 60
    )
      return `Line ${index + 2}: enter a term between 1 and 60 months.`;
  }
  return undefined;
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
  const available = offers.filter((offer) => offer.priceBookId === priceBookId);
  return (
    <section className={styles.section} aria-label="Additional quote lines">
      <h3>Additional capacity</h3>
      <p>
        Add another offer or region to the same quote. Each line is priced
        separately.
      </p>
      {lines.map((line, index) => (
        <fieldset key={index} className={styles.stageFields}>
          <legend>Line {index + 2}</legend>
          <div className={styles.formGrid}>
            <label>
              Offer for line {index + 2}
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
                <option value="">Choose an offer</option>
                {available.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Capacity (TB) for line {index + 2}
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
              Term (months) for line {index + 2}
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
            Remove line {index + 2}
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
        Add capacity line
      </button>
    </section>
  );
}
