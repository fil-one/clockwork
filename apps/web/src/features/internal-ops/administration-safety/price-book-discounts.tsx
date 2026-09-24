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
import type { MessageId, Translator } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { basisPointsText } from "./price-book-diff";
import { bookMoney, commerceErrorText } from "./price-book-presentation";
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

const routeLabels: Readonly<Record<(typeof routes)[number], MessageId>> = {
  direct: "adminPricing.route.direct",
  referral: "adminPricing.route.referral",
  resale: "adminPricing.route.resale",
  distributor: "adminPricing.route.distributor",
  marketplace: "adminPricing.route.marketplace",
};

const marginResultLabels: Readonly<
  Record<"not_configured" | "pass" | "exception_required", MessageId>
> = {
  not_configured: "adminPricing.simulation.guardrail.notConfigured",
  pass: "adminPricing.simulation.guardrail.pass",
  exception_required: "adminPricing.simulation.guardrail.exceptionRequired",
};

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
  const t = useTranslations();
  const [rules, setRules] = useState<DiscountMatrixRule[]>([
    ...(book.discountMatrix?.rules ?? []),
  ]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const editable =
    permitted && book.status === "draft" && !book.activationRequestedBy;
  return (
    <div className={styles.panelBody}>
      <h3>{t("adminPricing.discounts.title")}</h3>
      <p className={styles.resultMeta}>{t("adminPricing.discounts.intro")}</p>
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
              setMessage(t("adminPricing.discounts.saved"));
              onSaved();
            })
            .catch((error: unknown) =>
              setMessage(
                commerceErrorText(error, t, "adminPricing.discounts.failed"),
              ),
            )
            .finally(() => setPending(false));
        }}
      >
        <fieldset disabled={!editable || pending}>
          <legend>{t("adminPricing.discounts.matrixLegend")}</legend>
          <div className={styles.metaGrid}>
            <label className={styles.field}>
              {t("adminPricing.discounts.policyId")}
              <input
                name="matrixId"
                defaultValue={book.discountMatrix?.id ?? `discount-${book.id}`}
                required
                maxLength={120}
              />
            </label>
            <label className={styles.field}>
              {t("adminPricing.discounts.policyVersion")}
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
              {t("adminPricing.discounts.defaultCeiling")}
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
                <legend>
                  {t("adminPricing.discounts.rule", { number: index + 1 })}
                </legend>
                <div className={styles.metaGrid}>
                  <label className={styles.field}>
                    {t("adminPricing.discounts.skuAny")}
                    <input
                      value={rule.sku ?? ""}
                      maxLength={80}
                      onChange={(event) =>
                        change({ sku: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    {t("adminPricing.discounts.regionAny")}
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
                    {t("adminPricing.route.label")}
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
                      <option value="">{t("adminPricing.route.any")}</option>
                      {routes.map((route) => (
                        <option key={route} value={route}>
                          {t(routeLabels[route])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    {t("adminPricing.discounts.partnerTierAny")}
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
                    {t("adminPricing.discounts.minTerm")}
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
                    {t("adminPricing.rate.minimumQuantity")}
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
                    {t("adminPricing.discounts.ruleCeiling")}
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
                  {t("adminPricing.discounts.removeRule", {
                    number: index + 1,
                  })}
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
              {t("adminPricing.discounts.addRule")}
            </button>
            <button
              type="submit"
              className={styles.button}
              disabled={!book.rateCardCount}
            >
              {pending ? t("common.saving") : t("adminPricing.discounts.save")}
            </button>
          </div>
        </fieldset>
        {!editable ? (
          <p className={styles.resultMeta}>
            {t("adminPricing.discounts.readOnly")}
          </p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </form>
      <PriceBookSimulation book={book} />
    </div>
  );
}

/** The simulation outcome, worded from the priced result's facts. */
function simulationOutcome(
  priced: ReturnType<typeof priceQuote>,
  t: Translator,
  locale: string,
): string[] {
  return [
    t("adminPricing.simulation.total", {
      total: bookMoney(priced.total, locale),
    }),
    t(marginResultLabels[priced.marginResult]),
    ...priced.guardrailBreaches.map((breach) => {
      const rate = `${breach.sku} / ${breach.region}`;
      if (breach.guardrail === "floor")
        return t("adminPricing.simulation.breach.floor", {
          rate,
          quoted: bookMoney(breach.quotedUnitPrice, locale),
          floor: bookMoney(breach.guardrailUnitPrice, locale),
        });
      const line = priced.lines.find((entry) => entry.id === breach.lineId);
      return t("adminPricing.simulation.breach.discount", {
        rate,
        discount: basisPointsText(line?.discountBps ?? 0, t, locale),
        ceiling: basisPointsText(line?.discountCeilingBps ?? 0, t, locale),
        price: bookMoney(breach.guardrailUnitPrice, locale),
      });
    }),
  ];
}

function PriceBookSimulation({
  book,
}: {
  book: PriceBookAdministrationRecord;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const [result, setResult] = useState<readonly string[]>([]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const rate = book.rateCards?.find(
          (entry) => entry.id === values.get("rate"),
        );
        if (!rate) {
          setResult([t("adminPricing.simulation.selectRate")]);
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
          setResult(simulationOutcome(priced, t, formattingLocale));
        } catch (error) {
          // The pricing engine explains its refusals in English; the reason is
          // quoted inside the reader's own sentence.
          setResult([
            error instanceof Error
              ? t("adminPricing.simulation.failed", { detail: error.message })
              : t("adminPricing.simulation.failedGeneric"),
          ]);
        }
      }}
    >
      <h3>{t("adminPricing.simulation.title")}</h3>
      <p className={styles.resultMeta}>{t("adminPricing.simulation.intro")}</p>
      <div className={styles.metaGrid}>
        <label className={styles.field}>
          {t("adminPricing.simulation.rate")}
          <select name="rate" required>
            {book.rateCards?.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {rate.sku} / {rate.region}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t("adminPricing.simulation.quantity")}
          <input
            name="quantity"
            defaultValue="1"
            required
            pattern="[0-9]+(?:\.[0-9]{1,18})?"
          />
        </label>
        <label className={styles.field}>
          {t("adminPricing.simulation.term")}
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
          {t("adminPricing.simulation.discount")}
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
          {t("adminPricing.simulation.route")}
          <select name="route">
            {routes.map((route) => (
              <option key={route} value={route}>
                {t(routeLabels[route])}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t("adminPricing.simulation.partnerTier")}
          <input name="partnerTier" />
        </label>
      </div>
      <button
        type="submit"
        className={styles.button}
        disabled={!book.rateCards?.length}
      >
        {t("adminPricing.simulation.run")}
      </button>
      {result.length ? (
        <div role="status">
          {result.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
    </form>
  );
}
