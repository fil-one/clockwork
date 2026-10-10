"use client";

import {
  pricingSummaryPrintable,
  type PricingPartnerEconomics,
} from "@clockwork/contracts";
import type {
  PartnerFigures,
  ScenarioPartnerEconomics,
} from "@clockwork/domain/core";
import { Button, Input, Select } from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";

import styles from "./pricing.module.css";
import { bpsText, discountBps, minorText, priceMinor } from "./scenarios";

export type PartnerModel = "direct" | PricingPartnerEconomics["model"];

/** The partner inputs as the seller types them. */
export interface PartnerDraft {
  model: PartnerModel;
  partnerName: string;
  commission: string;
  steps: readonly { key: string; fromMonth: string; commission: string }[];
  customerPrice: string;
  resaleBasis: "margin" | "buyPrice";
  margin: string;
  buyPrice: string;
  label: string;
  share: string;
  perUnit: string;
  monthly: string;
}

export function partnerDraftOf(
  economics: PricingPartnerEconomics | null,
): PartnerDraft {
  const draft: PartnerDraft = {
    model: economics?.model ?? "direct",
    partnerName: economics?.partnerName ?? "",
    commission: "15",
    steps: [],
    customerPrice: "",
    resaleBasis: "margin",
    margin: "",
    buyPrice: "",
    label: "",
    share: "0",
    perUnit: "0",
    monthly: "0",
  };
  if (economics?.model === "referral")
    return {
      ...draft,
      commission: bpsText(economics.commissionBps),
      steps: economics.steps.map((step) => ({
        key: crypto.randomUUID(),
        fromMonth: String(step.fromMonth),
        commission: bpsText(step.commissionBps),
      })),
    };
  if (economics?.model === "resale")
    return {
      ...draft,
      customerPrice: minorText(economics.customerPriceMinor),
      resaleBasis:
        economics.buyPriceMinor === undefined ? "margin" : "buyPrice",
      margin:
        economics.marginBps === undefined ? "" : bpsText(economics.marginBps),
      buyPrice:
        economics.buyPriceMinor === undefined
          ? ""
          : minorText(economics.buyPriceMinor),
    };
  if (economics?.model === "other")
    return {
      ...draft,
      label: economics.label ?? "",
      share: bpsText(economics.partnerShareBps),
      perUnit: minorText(economics.partnerPerUnitMinor),
      monthly: minorText(economics.partnerMonthlyMinor),
    };
  return draft;
}

/** The fields the seller must correct, by field key. */
export type PartnerProblems = Readonly<Record<string, MessageId>>;

/**
 * The saved form of the draft: null for a direct scenario, or the problems
 * that keep it from being priced. Nothing here caps or floors an input.
 */
export function parsePartnerDraft(
  draft: PartnerDraft,
):
  | { ok: true; economics: PricingPartnerEconomics | null }
  | { ok: false; problems: PartnerProblems } {
  if (draft.model === "direct") return { ok: true, economics: null };
  const problems: Record<string, MessageId> = {};
  const percent = (key: string, value: string) => {
    const bps = discountBps(value);
    if (bps === null)
      problems[key] = "operations.sales.pricing.partner.error.percent";
    return bps ?? 0;
  };
  const price = (key: string, value: string) => {
    const minor = priceMinor(value);
    if (minor === null)
      problems[key] = "operations.sales.pricing.partner.error.price";
    return minor ?? "0";
  };
  const text = (
    key: string,
    value: string,
    max: number,
    message: MessageId,
  ) => {
    const trimmed = value.trim();
    if (
      trimmed.length > max ||
      !pricingSummaryPrintable.test(trimmed) ||
      [...trimmed].some((c) => c.charCodeAt(0) < 32)
    )
      problems[key] = message;
    return trimmed || undefined;
  };
  const partnerName = text(
    "partnerName",
    draft.partnerName,
    120,
    "operations.sales.pricing.partner.error.name",
  );
  const named = partnerName ? { partnerName } : {};
  let economics: PricingPartnerEconomics;
  if (draft.model === "referral") {
    let previous = 1;
    const steps = draft.steps.map((step) => {
      const month = Number(step.fromMonth);
      if (
        !/^\d{1,3}$/u.test(step.fromMonth.trim()) ||
        month < 2 ||
        month > 120 ||
        month <= previous
      )
        problems[`step:${step.key}:fromMonth`] =
          "operations.sales.pricing.partner.error.month";
      previous = Math.max(previous, month || previous);
      return {
        fromMonth: month,
        commissionBps: percent(`step:${step.key}:commission`, step.commission),
      };
    });
    economics = {
      model: "referral",
      ...named,
      commissionBps: percent("commission", draft.commission),
      steps,
    };
  } else if (draft.model === "resale") {
    economics = {
      model: "resale",
      ...named,
      customerPriceMinor: price("customerPrice", draft.customerPrice),
      ...(draft.resaleBasis === "margin"
        ? { marginBps: percent("margin", draft.margin) }
        : { buyPriceMinor: price("buyPrice", draft.buyPrice) }),
    };
  } else {
    const label = text(
      "label",
      draft.label,
      80,
      "operations.sales.pricing.partner.error.label",
    );
    economics = {
      model: "other",
      ...named,
      ...(label ? { label } : {}),
      partnerShareBps: percent("share", draft.share),
      partnerPerUnitMinor: price("perUnit", draft.perUnit),
      partnerMonthlyMinor: price("monthly", draft.monthly),
    };
  }
  return Object.keys(problems).length
    ? { ok: false, problems }
    : { ok: true, economics };
}

/** What the seller has typed in the field a problem key names. */
function typed(draft: PartnerDraft, key: string): string {
  const [kind, stepKey, field] = key.split(":");
  if (kind === "step") {
    const step = draft.steps.find((candidate) => candidate.key === stepKey);
    return field === "fromMonth"
      ? (step?.fromMonth ?? "")
      : (step?.commission ?? "");
  }
  const value = draft[key as keyof PartnerDraft];
  return typeof value === "string" ? value : "";
}

const models: readonly PartnerModel[] = [
  "direct",
  "referral",
  "resale",
  "other",
];

/**
 * The partner economics panel: the seller picks a model and enters its terms,
 * and sees what the partner earns and what Fil One keeps per month, in year
 * 1, over the term and per unit. Indicative only.
 */
export function PartnerEconomicsPanel({
  draft,
  onChange,
  problems,
  showEmpty,
  result,
  unit,
  money,
  percent,
  t,
}: {
  draft: PartnerDraft;
  onChange: (draft: PartnerDraft) => void;
  problems: PartnerProblems;
  /** After a save attempt: also flag fields left empty. */
  showEmpty: boolean;
  /** Null while the lines or the inputs cannot be priced. */
  result: ScenarioPartnerEconomics | null;
  /** The lines' shared capacity unit, or null when they differ. */
  unit: string | null;
  money: (value: { currency: string; minor: string }) => string;
  percent: (bps: number) => string;
  t: Translator;
}) {
  const set = (change: Partial<PartnerDraft>) =>
    onChange({ ...draft, ...change });
  const unitLabel = unit ?? "TB";
  // A field left empty is flagged only once the seller tries to save.
  const error = (key: string) => {
    const id = problems[key];
    return id && (showEmpty || typed(draft, key).trim()) ? t(id) : undefined;
  };
  const yearLabel = (index: number) =>
    result && (index + 1) * 12 > result.months
      ? t("operations.sales.pricing.partner.years.partial", {
          number: String(index + 1),
          from: String(index * 12 + 1),
          to: String(result.months),
        })
      : t("operations.sales.pricing.partner.years.year", {
          number: String(index + 1),
        });
  const resaleDerived =
    result?.resale && draft.model === "resale"
      ? draft.resaleBasis === "margin"
        ? t("operations.sales.pricing.partner.derivedBuyPrice", {
            price: money(result.resale.buyPrice),
            unit: unitLabel,
          })
        : result.resale.marginBps === null
          ? undefined
          : t("operations.sales.pricing.partner.derivedMargin", {
              percent: percent(result.resale.marginBps),
            })
      : undefined;
  const figureRows: [MessageId, keyof PartnerFigures][] = [
    ["operations.sales.pricing.partner.row.customer", "customerSpend"],
    ["operations.sales.pricing.partner.row.partner", "partnerEarnings"],
    ["operations.sales.pricing.partner.row.net", "filOneNet"],
  ];
  return (
    <fieldset className={styles.partner}>
      <legend>{t("operations.sales.pricing.partner.legend")}</legend>
      <p className={styles.partnerHelp}>
        {t("operations.sales.pricing.partner.help")}
      </p>
      <div className={styles.lineFields}>
        <Select
          label={t("operations.sales.pricing.partner.model")}
          value={draft.model}
          onChange={(event) =>
            set({ model: event.target.value as PartnerModel })
          }
          options={models.map((model) => ({
            value: model,
            label: t(`operations.sales.pricing.partner.model.${model}`),
          }))}
        />
        {draft.model === "direct" ? null : (
          <Input
            label={t("operations.sales.pricing.partner.name")}
            help={t("operations.sales.pricing.partner.nameHelp")}
            fieldClassName={styles.span2 ?? ""}
            value={draft.partnerName}
            maxLength={120}
            error={error("partnerName")}
            onChange={(event) => set({ partnerName: event.target.value })}
          />
        )}
        {draft.model === "referral" ? (
          <>
            <Input
              label={t("operations.sales.pricing.partner.commission")}
              help={t("operations.sales.pricing.partner.commissionHelp")}
              inputMode="decimal"
              value={draft.commission}
              error={error("commission")}
              onChange={(event) => set({ commission: event.target.value })}
            />
            {draft.steps.map((step, index) => {
              const number = String(index + 1);
              const change = (patch: Partial<typeof step>) =>
                set({
                  steps: draft.steps.map((other) =>
                    other.key === step.key ? { ...other, ...patch } : other,
                  ),
                });
              return (
                <div className={styles.step} key={step.key}>
                  <Input
                    label={t("operations.sales.pricing.partner.stepFrom", {
                      number,
                    })}
                    inputMode="numeric"
                    value={step.fromMonth}
                    error={error(`step:${step.key}:fromMonth`)}
                    onChange={(event) =>
                      change({ fromMonth: event.target.value })
                    }
                  />
                  <Input
                    label={t(
                      "operations.sales.pricing.partner.stepCommission",
                      { number },
                    )}
                    inputMode="decimal"
                    value={step.commission}
                    error={error(`step:${step.key}:commission`)}
                    onChange={(event) =>
                      change({ commission: event.target.value })
                    }
                  />
                  <Button
                    variant="quiet"
                    size="small"
                    onClick={() =>
                      set({
                        steps: draft.steps.filter(
                          ({ key }) => key !== step.key,
                        ),
                      })
                    }
                  >
                    {t("operations.sales.pricing.partner.removeStep", {
                      number,
                    })}
                  </Button>
                </div>
              );
            })}
            <div className={styles.wide}>
              <Button
                variant="secondary"
                size="small"
                disabled={draft.steps.length >= 12}
                onClick={() => {
                  const last = Number(draft.steps.at(-1)?.fromMonth ?? 1);
                  set({
                    steps: [
                      ...draft.steps,
                      {
                        key: crypto.randomUUID(),
                        fromMonth: String(
                          Math.min(
                            120,
                            (Number.isFinite(last) ? last : 1) + 12,
                          ),
                        ),
                        commission: "",
                      },
                    ],
                  });
                }}
              >
                {t("operations.sales.pricing.partner.addStep")}
              </Button>
            </div>
          </>
        ) : null}
        {draft.model === "resale" ? (
          <>
            <Input
              label={t("operations.sales.pricing.partner.customerPrice", {
                unit: unitLabel,
              })}
              inputMode="decimal"
              value={draft.customerPrice}
              error={error("customerPrice")}
              onChange={(event) => set({ customerPrice: event.target.value })}
            />
            <Select
              label={t("operations.sales.pricing.partner.resaleBasis")}
              value={draft.resaleBasis}
              onChange={(event) =>
                set({
                  resaleBasis: event.target
                    .value as PartnerDraft["resaleBasis"],
                })
              }
              options={(["margin", "buyPrice"] as const).map((basis) => ({
                value: basis,
                label: t(
                  `operations.sales.pricing.partner.resaleBasis.${basis}`,
                ),
              }))}
            />
            {draft.resaleBasis === "margin" ? (
              <Input
                label={t("operations.sales.pricing.partner.margin")}
                inputMode="decimal"
                value={draft.margin}
                error={error("margin")}
                {...(resaleDerived
                  ? { help: resaleDerived }
                  : {
                      help: t("operations.sales.pricing.partner.marginHelp"),
                    })}
                onChange={(event) => set({ margin: event.target.value })}
              />
            ) : (
              <Input
                label={t("operations.sales.pricing.partner.buyPrice", {
                  unit: unitLabel,
                })}
                inputMode="decimal"
                value={draft.buyPrice}
                error={error("buyPrice")}
                {...(resaleDerived ? { help: resaleDerived } : {})}
                onChange={(event) => set({ buyPrice: event.target.value })}
              />
            )}
          </>
        ) : null}
        {draft.model === "other" ? (
          <>
            <Input
              label={t("operations.sales.pricing.partner.label")}
              help={t("operations.sales.pricing.partner.labelHelp")}
              fieldClassName={styles.wide ?? ""}
              value={draft.label}
              maxLength={80}
              error={error("label")}
              onChange={(event) => set({ label: event.target.value })}
            />
            <Input
              label={t("operations.sales.pricing.partner.share")}
              inputMode="decimal"
              value={draft.share}
              error={error("share")}
              onChange={(event) => set({ share: event.target.value })}
            />
            <Input
              label={t("operations.sales.pricing.partner.perUnit", {
                unit: unitLabel,
              })}
              inputMode="decimal"
              value={draft.perUnit}
              error={error("perUnit")}
              onChange={(event) => set({ perUnit: event.target.value })}
            />
            <Input
              label={t("operations.sales.pricing.partner.monthly")}
              inputMode="decimal"
              value={draft.monthly}
              error={error("monthly")}
              onChange={(event) => set({ monthly: event.target.value })}
            />
          </>
        ) : null}
      </div>
      {draft.model === "direct" ? null : !unit ? (
        <p className={styles.warning} role="note">
          {t("operations.sales.pricing.partner.mixedUnits")}
        </p>
      ) : !result ? (
        <p className={styles.partnerHelp}>
          {t("operations.sales.pricing.partner.invalid")}
        </p>
      ) : (
        <div className={styles.partnerFigures}>
          {result.resale?.marginBps !== undefined &&
          result.resale.marginBps !== null &&
          result.resale.marginBps < 0 ? (
            <p className={styles.warning} role="note">
              {t("operations.sales.pricing.partner.negativeMargin")}
            </p>
          ) : null}
          <table className={styles.table}>
            <caption>{t("operations.sales.pricing.partner.figures")}</caption>
            <thead>
              <tr>
                <td />
                <th scope="col">
                  {t("operations.sales.pricing.partner.col.month")}
                </th>
                <th scope="col">{yearLabel(0)}</th>
                <th scope="col">
                  {t("operations.sales.pricing.partner.col.term", {
                    months: String(result.months),
                  })}
                </th>
                <th scope="col">
                  {t("operations.sales.pricing.partner.col.perUnit", {
                    unit: unitLabel,
                  })}
                </th>
              </tr>
            </thead>
            <tbody>
              {figureRows.map(([label, key]) => (
                <tr key={key}>
                  <th scope="row">{t(label)}</th>
                  <td>{money(result.firstMonth[key])}</td>
                  <td>{money(result.firstYear[key])}</td>
                  <td>{money(result.term[key])}</td>
                  <td>
                    {money(
                      result.periods[0]?.perUnit[key] ?? result.firstMonth[key],
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.periods.length > 1 ? (
            <table className={styles.table}>
              <caption>{t("operations.sales.pricing.partner.periods")}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {t("operations.sales.pricing.partner.periods.months")}
                  </th>
                  {draft.model === "referral" ? (
                    <th scope="col">
                      {t("operations.sales.pricing.partner.periods.commission")}
                    </th>
                  ) : null}
                  <th scope="col">
                    {t("operations.sales.pricing.partner.periods.partner")}
                  </th>
                  <th scope="col">
                    {t("operations.sales.pricing.partner.periods.net")}
                  </th>
                  <th scope="col">
                    {t("operations.sales.pricing.partner.col.perUnit", {
                      unit: unitLabel,
                    })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.periods.map((period) => (
                  <tr key={period.fromMonth}>
                    <th scope="row">
                      {t("operations.sales.pricing.partner.periods.range", {
                        from: String(period.fromMonth),
                        to: String(period.toMonth),
                      })}
                    </th>
                    {period.commissionBps === undefined ? null : (
                      <td>{percent(period.commissionBps)}</td>
                    )}
                    <td>{money(period.monthly.partnerEarnings)}</td>
                    <td>{money(period.monthly.filOneNet)}</td>
                    <td>{money(period.perUnit.partnerEarnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {result.years.length > 1 ? (
            <table className={styles.table}>
              <caption>{t("operations.sales.pricing.partner.years")}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {t("operations.sales.pricing.partner.years.yearLabel")}
                  </th>
                  <th scope="col">
                    {t("operations.sales.pricing.partner.row.partner")}
                  </th>
                  <th scope="col">
                    {t("operations.sales.pricing.partner.row.net")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.years.map((year, index) => (
                  <tr key={index}>
                    <th scope="row">{yearLabel(index)}</th>
                    <td>{money(year.partnerEarnings)}</td>
                    <td>{money(year.filOneNet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}
