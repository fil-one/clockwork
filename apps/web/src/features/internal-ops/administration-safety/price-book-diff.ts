import type { PriceBookAdministrationRecord } from "@clockwork/db";
import type { DiscountMatrix, RateCard } from "@clockwork/domain/core";

import type { MessageId, Translator } from "@/src/i18n";

import {
  bookMoney,
  commitTypeLabel,
  egressTreatmentLabel,
  formatBasisPoints,
  formatQuantity,
  unitLabel,
} from "./price-book-presentation";

type Money = { readonly currency: string; readonly minor: string };

/**
 * One compared field: `fact` is what is compared (minor units and currency,
 * codes, quantities), `text` is how the reader sees it. Rendered text is never
 * compared, so two readers in different languages always see the same set of
 * changes.
 */
interface FieldFact {
  readonly fact: string;
  readonly text: (t: Translator, locale: string) => string;
}

const fields = [
  ["listPrice", "adminPricing.rate.listPrice"],
  ["floorPrice", "adminPricing.rate.floorPrice"],
  ["overageRate", "adminPricing.rate.overageRate"],
  ["minimumQuantity", "adminPricing.rate.minimumQuantity"],
  ["unit", "adminPricing.rate.unit"],
  ["commitType", "adminPricing.rate.commitType"],
  ["approvedClaim", "adminPricing.rate.approvedClaim"],
  ["egressTreatment", "adminPricing.rate.egressTreatment"],
  ["taxCode", "adminPricing.rate.taxCode"],
  ["incomeAccount", "adminPricing.rate.incomeAccount"],
  ["legacyTrialQuantity", "adminPricing.rate.legacyTrialQuantity"],
  ["transferPrices", "adminPricing.rate.transferPrices"],
] as const satisfies readonly (readonly [string, MessageId])[];

type RateField = (typeof fields)[number][0];

function money(value: Money | undefined): FieldFact {
  return value
    ? {
        fact: `${value.currency}:${value.minor}`,
        text: (_t, locale) => bookMoney(value, locale),
      }
    : { fact: "", text: (t) => t("adminPricing.rate.notConfigured") };
}

function plain(value: string): FieldFact {
  return { fact: value, text: () => value };
}

function facts(rate: RateCard): Readonly<Record<RateField, FieldFact>> {
  const transfers = Object.entries(rate.partnerTransferPrices).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return {
    listPrice: money(rate.unitPrice),
    floorPrice: money(rate.floorPrice),
    overageRate: money(rate.overageRate),
    minimumQuantity: {
      fact: rate.minimumQuantity,
      text: (_t, locale) => formatQuantity(rate.minimumQuantity, locale),
    },
    unit: { fact: rate.unit, text: (t) => unitLabel(rate.unit, t) },
    commitType: {
      fact: rate.commitType,
      text: (t) => commitTypeLabel(rate.commitType, t),
    },
    approvedClaim: plain(rate.approvedClaim),
    egressTreatment: {
      fact: rate.egressTreatment,
      text: (t) => egressTreatmentLabel(rate.egressTreatment, t),
    },
    taxCode: plain(rate.stripeTaxCode),
    incomeAccount: plain(rate.qboIncomeAccount),
    legacyTrialQuantity: rate.trialLimit
      ? {
          fact: rate.trialLimit,
          text: (_t, locale) => formatQuantity(rate.trialLimit ?? "", locale),
        }
      : { fact: "", text: (t) => t("adminPricing.rate.notConfigured") },
    transferPrices: {
      fact: JSON.stringify(
        transfers.map(([tier, value]) => [tier, value.currency, value.minor]),
      ),
      text: (t, locale) =>
        transferPriceList(
          transfers.map(([tier, value]) => ({ tier, value })),
          t,
          locale,
        ),
    },
  };
}

/** "reseller: $120.00, distributor: $102.00" in the reader's list style. */
export function transferPriceList(
  entries: readonly { tier: string; value: Money }[],
  t: Translator,
  locale: string,
): string {
  if (!entries.length) return t("common.none");
  return new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(
    entries.map(({ tier, value }) =>
      t("adminPricing.rate.transferPrice", {
        tier,
        amount: bookMoney(value, locale),
      }),
    ),
  );
}

type MatrixLike = Pick<DiscountMatrix, "defaultMaxDiscountBps" | "rules">;

/**
 * The economic content of a discount matrix. Its policy identifier, version
 * and rule identifiers are surrogates: a cloned book gets new ones without any
 * change in who may discount how much.
 */
function matrixFact(matrix: MatrixLike | undefined): string {
  const rules = (matrix?.rules ?? [])
    .map((rule) =>
      JSON.stringify(
        Object.entries(rule)
          .filter(([key]) => key !== "id")
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    )
    .sort();
  return JSON.stringify([matrix?.defaultMaxDiscountBps ?? 0, rules]);
}

/** "Default ceiling 500 bps (5%); 2 scoped rules", for the reader. */
export function discountMatrixSummary(
  matrix: MatrixLike | undefined,
  t: Translator,
  locale: string,
): string {
  return t("adminPricing.discounts.summary", {
    ceiling: basisPointsText(matrix?.defaultMaxDiscountBps ?? 0, t, locale),
    count: matrix?.rules.length ?? 0,
  });
}

/** "500 bps (5%)" with both numbers in the reader's format. */
export function basisPointsText(
  bps: number,
  t: Translator,
  locale: string,
): string {
  return t("adminPricing.discounts.bps", {
    count: bps,
    percent: formatBasisPoints(bps, locale).percent,
  });
}

/**
 * Compare economic content, excluding surrogate rate and policy identifiers,
 * and word only what changed for the reader.
 */
export function priceBookEconomicDiff(
  candidate: PriceBookAdministrationRecord,
  active: PriceBookAdministrationRecord,
  t: Translator,
  locale: string,
): { key: string; field: string; before: string; after: string }[] {
  const changes: {
    key: string;
    field: string;
    before: string;
    after: string;
  }[] = [];
  const byRate = (book: PriceBookAdministrationRecord) =>
    new Map(
      (book.rateCards ?? []).map((rate) => [
        `${rate.sku} / ${rate.region}`,
        facts(rate),
      ]),
    );
  const previous = byRate(active);
  const next = byRate(candidate);
  for (const rate of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(rate);
    const after = next.get(rate);
    for (const [field, label] of fields) {
      const old = before?.[field];
      const current = after?.[field];
      if (old && current && old.fact === current.fact) continue;
      changes.push({
        key: `${rate}|${field}`,
        field: t("common.join.labels", { first: rate, second: t(label) }),
        before: old ? old.text(t, locale) : t("adminPricing.diff.rateAbsent"),
        after: current
          ? current.text(t, locale)
          : t("adminPricing.diff.rateRemoved"),
      });
    }
  }
  const beforeMatrix = active.discountMatrix;
  const afterMatrix = candidate.discountMatrix;
  if (matrixFact(beforeMatrix) !== matrixFact(afterMatrix)) {
    const before = discountMatrixSummary(beforeMatrix, t, locale);
    const after = discountMatrixSummary(afterMatrix, t, locale);
    changes.push({
      key: "discountAuthority",
      field: t("adminPricing.discounts.title"),
      before,
      after:
        before === after
          ? t("adminPricing.diff.rulesChanged", { summary: after })
          : after,
    });
  }
  return changes;
}
