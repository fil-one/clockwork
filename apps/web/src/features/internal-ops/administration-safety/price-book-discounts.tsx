"use client";

import { useState } from "react";
import type { PriceBookAdministrationRecord } from "@clockwork/db";
import {
  priceQuote,
  type DiscountMatrixRule,
  type PriceBook,
  type QuoteRoute,
} from "@clockwork/domain/core";
import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { styles } from "./ui";

function formString(values: FormData, name: string): string {
  const value = values.get(name);
  return typeof value === "string" ? value : "";
}

const routes = [
  "direct",
  "referral",
  "resale",
  "distributor",
  "marketplace",
] as const;

/** Edits the signed authority matrix; saving never publishes it. */
export function DiscountMatrixEditor({
  book,
  permitted,
  onSaved,
}: {
  book: PriceBookAdministrationRecord;
  permitted: boolean;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<DiscountMatrixRule[]>([
    ...(book.discountMatrix?.rules ?? []),
  ]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const editable =
    permitted && book.status === "draft" && !book.activationRequestedBy;
  return (
    <div className={styles.panelBody}>
      <h3>Discount authority</h3>
      <p className={styles.resultMeta}>
        Ceilings are basis points: 100 = 1%. A matching rule can raise the
        default ceiling; the greatest matching grant wins. Regional floors still
        apply. Changes require a fresh two-person activation.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!editable || pending) return;
          const values = new FormData(event.currentTarget);
          setPending(true);
          setMessage("");
          void sendCoreCommand({
            resource: "price_books",
            id: book.id,
            action: "update_discount_matrix",
            expectedVersion: book.rowVersion,
            payload: {
              id: formString(values, "matrixId").trim(),
              version: Number(values.get("matrixVersion")),
              defaultMaxDiscountBps: Number(
                values.get("defaultMaxDiscountBps"),
              ),
              rules,
            },
          })
            .then(() => {
              setMessage("Discount authority saved to the draft.");
              onSaved();
            })
            .catch((error: unknown) =>
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Discount authority was not saved.",
              ),
            )
            .finally(() => setPending(false));
        }}
      >
        <fieldset disabled={!editable || pending}>
          <legend>Versioned discount matrix</legend>
          <div className={styles.metaGrid}>
            <label className={styles.field}>
              Policy identifier
              <input
                name="matrixId"
                defaultValue={book.discountMatrix?.id ?? `discount-${book.id}`}
                required
                maxLength={120}
              />
            </label>
            <label className={styles.field}>
              Policy version
              <input
                name="matrixVersion"
                type="number"
                min={1}
                step={1}
                defaultValue={book.discountMatrix?.version || 1}
                required
              />
            </label>
            <label className={styles.field}>
              Default discount ceiling (bps)
              <input
                name="defaultMaxDiscountBps"
                type="number"
                min={0}
                max={10000}
                step={1}
                defaultValue={book.discountMatrix?.defaultMaxDiscountBps ?? 0}
                required
              />
            </label>
          </div>
          {rules.map((rule, index) => {
            const change = (patch: {
              [Key in keyof DiscountMatrixRule]?:
                DiscountMatrixRule[Key] | undefined;
            }) =>
              setRules((current) =>
                current.map((entry, position) =>
                  position === index
                    ? (Object.fromEntries(
                        Object.entries({ ...entry, ...patch }).filter(
                          ([, value]) => value !== undefined,
                        ),
                      ) as unknown as DiscountMatrixRule)
                    : entry,
                ),
              );
            return (
              <fieldset key={rule.id}>
                <legend>Rule {index + 1}</legend>
                <div className={styles.metaGrid}>
                  <label className={styles.field}>
                    SKU (blank = any)
                    <input
                      value={rule.sku ?? ""}
                      maxLength={80}
                      onChange={(event) =>
                        change({ sku: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Region (blank = any)
                    <input
                      value={rule.region ?? ""}
                      maxLength={80}
                      onChange={(event) =>
                        change({
                          region: event.currentTarget.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Route
                    <select
                      value={rule.route ?? ""}
                      onChange={(event) =>
                        change({
                          route: event.currentTarget.value
                            ? (event.currentTarget.value as QuoteRoute)
                            : undefined,
                        })
                      }
                    >
                      <option value="">Any route</option>
                      {routes.map((route) => (
                        <option key={route}>{route}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    Partner tier (blank = any)
                    <input
                      value={rule.partnerTier ?? ""}
                      maxLength={80}
                      onChange={(event) =>
                        change({
                          partnerTier: event.currentTarget.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Minimum term (months)
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={rule.minTermMonths ?? ""}
                      onChange={(event) =>
                        change({
                          minTermMonths: event.currentTarget.value
                            ? Number(event.currentTarget.value)
                            : undefined,
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Minimum quantity
                    <input
                      inputMode="decimal"
                      pattern="[0-9]+(?:\.[0-9]{1,18})?"
                      value={rule.minQuantity ?? ""}
                      onChange={(event) =>
                        change({
                          minQuantity: event.currentTarget.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Discount ceiling (bps)
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      value={rule.maxDiscountBps}
                      required
                      onChange={(event) =>
                        change({
                          maxDiscountBps: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() =>
                    setRules((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  Remove rule {index + 1}
                </button>
              </fieldset>
            );
          })}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                setRules((current) => [
                  ...current,
                  { id: crypto.randomUUID(), maxDiscountBps: 0 },
                ])
              }
            >
              Add discount rule
            </button>
            <button
              type="submit"
              className={styles.button}
              disabled={!book.rateCardCount}
            >
              {pending ? "Saving…" : "Save discount authority"}
            </button>
          </div>
        </fieldset>
        {!editable ? (
          <p className={styles.resultMeta}>
            Published and proposed policy is read only. A rejected draft can be
            edited and proposed again.
          </p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </form>
      <PriceBookSimulation book={book} />
    </div>
  );
}

function PriceBookSimulation({
  book,
}: {
  book: PriceBookAdministrationRecord;
}) {
  const [result, setResult] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const rate = book.rateCards?.find(
          (entry) => entry.id === values.get("rate"),
        );
        if (!rate) {
          setResult("Select a persisted rate card.");
          return;
        }
        try {
          const priced = priceQuote({
            book: {
              id: book.id,
              name: book.name,
              version: book.version,
              effectiveFrom: book.effectiveFrom,
              currency: book.currency as PriceBook["currency"],
              status: "active",
              rateCards: book.rateCards ?? [],
              ...(book.discountMatrix
                ? { discountMatrix: book.discountMatrix }
                : {}),
            },
            lines: [
              {
                sku: rate.sku,
                region: rate.region,
                quantity: formString(values, "quantity"),
                termMonths: Number(values.get("termMonths")),
                discountBps: Number(values.get("discountBps")),
              },
            ],
            route: formString(values, "route") as QuoteRoute,
            ...(values.get("partnerTier")
              ? { partnerTier: formString(values, "partnerTier") }
              : {}),
            quotedAt: `${book.effectiveFrom}T00:00:00.000Z`,
          });
          const minor = BigInt(priced.total.minor);
          setResult(
            `${book.currency} ${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")} tax-exclusive term total. Guardrails: ${priced.marginResult.replaceAll("_", " ")}.${priced.exceptionReasons.length ? ` ${priced.exceptionReasons.join("; ")}` : ""}`,
          );
        } catch (error) {
          setResult(
            error instanceof Error
              ? error.message
              : "Simulation could not run.",
          );
        }
      }}
    >
      <h3>Term quote simulation</h3>
      <p className={styles.resultMeta}>
        Preview saved rates and discount authority at the effective date. This
        does not activate a book or create a quote. PAYG usage rating and
        monthly minimums are a separate billing policy.
      </p>
      <div className={styles.metaGrid}>
        <label className={styles.field}>
          Simulation rate
          <select name="rate" required>
            {book.rateCards?.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {rate.sku} / {rate.region}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Simulation quantity
          <input
            name="quantity"
            defaultValue="1"
            required
            pattern="[0-9]+(?:\.[0-9]{1,18})?"
          />
        </label>
        <label className={styles.field}>
          Simulation term (months)
          <input
            name="termMonths"
            type="number"
            min={1}
            step={1}
            defaultValue={12}
            required
          />
        </label>
        <label className={styles.field}>
          Simulation discount (bps)
          <input
            name="discountBps"
            type="number"
            min={0}
            max={10000}
            step={1}
            defaultValue={0}
            required
          />
        </label>
        <label className={styles.field}>
          Simulation route
          <select name="route">
            {routes.map((route) => (
              <option key={route}>{route}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Simulation partner tier
          <input name="partnerTier" />
        </label>
      </div>
      <button
        type="submit"
        className={styles.button}
        disabled={!book.rateCards?.length}
      >
        Simulate saved pricing
      </button>
      {result ? <p role="status">{result}</p> : null}
    </form>
  );
}
