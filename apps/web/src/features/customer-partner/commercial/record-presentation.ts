import { formatDate, formatMoney } from "@/src/features/shared/format";
import type { MessageId, Translator } from "@/src/i18n";

import type { CollectionKind, CommercialRecord } from "./model";
import {
  projectionCompat,
  type ProjectionCompatStrings,
} from "./projection-compat";
import {
  readCommercialFacts,
  type CommercialFacts,
  type CommercialNextFact,
  type CommercialTermFact,
  type CommercialTimingFact,
  type CommercialValueFact,
  type CommercialValueLabel,
} from "./record-facts";

/**
 * A commercial record as one reader sees it.
 *
 * Every string here comes from the record's facts, rendered with the reader's
 * translator and formatting locale, when the record carries facts. A record
 * without them -- a production projection, or a demo record whose fixture has
 * none -- keeps the display strings it arrived with, exactly as written.
 */
export interface CommercialDisplay {
  description: string;
  statusLabel: string;
  value: string;
  valueLabel: string;
  /** The timing phrase: "Due Aug 8, 2026", "Updated Jul 30, 2026". */
  timing: string;
  term: string;
  nextAction: string;
  /** A number to order the value column by; null when there is none. */
  valueSort: number | null;
}

/**
 * Status chips per collection. Each form agrees with its collection's noun
 * (a quote, an order, an invoice, a proof of concept), which is why the
 * generic `status.*` set is used only where its form already agrees.
 */
const statusLabels: Readonly<
  Record<CollectionKind, Readonly<Record<string, MessageId>>>
> = {
  quotes: {
    draft: "status.quote.draft",
    open: "customer.commercial.status.quote.open",
    issued: "status.quote.issued",
    accepted: "status.quote.accepted",
    canceled: "customer.commercial.status.quote.canceled",
    expired: "status.quote.expired",
    complete: "customer.commercial.status.actionComplete",
  },
  agreements: {
    active: "customer.commercial.status.agreement.active",
    review: "customer.commercial.status.agreement.review",
    complete: "customer.commercial.status.actionComplete",
  },
  orders: {
    active: "status.order.active",
    provisioning: "status.order.provisioning",
    renewal_requested: "status.renewalRequested",
    offboarding_requested: "status.offboardingRequested",
    complete: "customer.commercial.status.actionComplete",
  },
  services: {
    active: "customer.commercial.status.service.active",
    provisioning: "status.provisioning",
    offboarding_requested: "status.offboardingRequested",
    complete: "customer.commercial.status.actionComplete",
  },
  pocs: {
    active: "customer.commercial.status.poc.active",
    complete: "customer.commercial.status.poc.complete",
    converted: "customer.commercial.status.poc.converted",
  },
  billing: {
    open: "status.invoice.open",
    paid: "status.invoice.paid",
    complete: "customer.commercial.status.actionComplete",
  },
};

/**
 * The next action a demo projection action leaves a record with. The facts a
 * fixture carries describe the status it was written in; once an action moves
 * the record on, the action's own next step is the one that applies.
 */
const actionNext: Readonly<
  Record<CollectionKind, Readonly<Record<string, MessageId>>>
> = {
  quotes: {
    accepted: "customer.commercial.next.continueOrderAcceptance",
    expired: "customer.commercial.next.createRevisedQuote",
  },
  agreements: { active: "customer.commercial.next.useAgreementVersion" },
  orders: {
    renewal_requested: "customer.commercial.next.reviewRenewalQuote",
    offboarding_requested: "customer.commercial.next.awaitRetentionReview",
  },
  services: {
    offboarding_requested: "customer.commercial.next.awaitRetentionReview",
  },
  pocs: { converted: "customer.commercial.next.reviewConversionQuote" },
  billing: {},
};

const valueLabels: Readonly<Record<CommercialValueLabel, MessageId>> = {
  termEnd: "customer.commercial.valueLabel.termEnd",
  responseDue: "customer.commercial.valueLabel.responseDue",
  estimatedAnnualSpend: "customer.commercial.valueLabel.estimatedAnnualSpend",
  acceptedEstimatedSpend:
    "customer.commercial.valueLabel.acceptedEstimatedSpend",
  canceledEstimate: "customer.commercial.valueLabel.canceledEstimate",
  committedAnnualSpend: "customer.commercial.valueLabel.committedAnnualSpend",
  capacityUsage: "customer.commercial.valueLabel.capacityUsage",
  provisioning: "customer.commercial.valueLabel.provisioning",
  timeRemaining: "customer.commercial.valueLabel.timeRemaining",
  outcome: "customer.commercial.valueLabel.outcome",
  invoicedAmount: "customer.commercial.valueLabel.invoicedAmount",
};

const timingMessages: Readonly<
  Record<CommercialTimingFact["kind"], MessageId>
> = {
  updated: "customer.commercial.timing.updated",
  expires: "customer.commercial.timing.expires",
  accepted: "customer.commercial.timing.accepted",
  canceled: "customer.commercial.timing.canceled",
  started: "customer.commercial.timing.started",
  starts: "customer.commercial.timing.starts",
  metered: "customer.commercial.timing.metered",
  completed: "customer.commercial.timing.completed",
  due: "customer.commercial.timing.due",
  providerConfirmed: "customer.commercial.timing.providerConfirmed",
};

const nextMessages: Readonly<Record<CommercialNextFact["kind"], MessageId>> = {
  noActionDue: "customer.commercial.next.noActionDue",
  reviewNegotiatedTerms: "customer.commercial.next.reviewNegotiatedTerms",
  acceptOrCancelBeforeExpiry:
    "customer.commercial.next.acceptOrCancelBeforeExpiry",
  finishAndIssueQuote: "customer.commercial.next.finishAndIssueQuote",
  reviewAndAcceptOrder: "customer.commercial.next.reviewAndAcceptOrder",
  noActionsAvailable: "customer.commercial.next.noActionsAvailable",
  renewalNoticeOpens: "customer.commercial.next.renewalNoticeOpens",
  completeProvisioningChecklist:
    "customer.commercial.next.completeProvisioningChecklist",
  confirmEncryptionKeyHandoff:
    "customer.commercial.next.confirmEncryptionKeyHandoff",
  completeRestoreValidation:
    "customer.commercial.next.completeRestoreValidation",
  reviewPaidConversion: "customer.commercial.next.reviewPaidConversion",
  reviewAndPayBy: "customer.commercial.next.reviewAndPayBy",
};

function utcDay(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** "Jan 1 – Dec 31, 2026" in the reader's locale, one range, one formatter. */
export function formatDateRange(
  start: string,
  end: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).formatRange(utcDay(start), utcDay(end));
}

function percent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(ratio);
}

function valueText(
  value: CommercialValueFact,
  t: Translator,
  locale: string,
): string {
  switch (value.kind) {
    case "money":
      return formatMoney(value.amountMinor, value.currency, locale);
    case "date":
      return formatDate(value.on, locale);
    case "capacityUsed":
      return t("customer.commercial.value.capacityUsed", {
        percent: percent(value.ratio, locale),
      });
    case "provisioningReady":
      return t("customer.commercial.value.provisioningReady", {
        percent: percent(value.ratio, locale),
      });
    case "daysLeft":
      return t("customer.commercial.value.daysLeft", { count: value.days });
    case "readyToConvert":
      return t("customer.commercial.value.readyToConvert");
  }
}

function valueSort(value: CommercialValueFact): number {
  switch (value.kind) {
    case "money":
      return Number(value.amountMinor);
    case "date":
      return utcDay(value.on).getTime();
    case "capacityUsed":
    case "provisioningReady":
      return value.ratio;
    case "daysLeft":
      return value.days;
    case "readyToConvert":
      return 0;
  }
}

function termText(
  term: CommercialTermFact,
  t: Translator,
  locale: string,
): string {
  const date = (value: string) => formatDate(value, locale);
  switch (term.kind) {
    case "period": {
      const period = formatDateRange(term.start, term.end, locale);
      if (term.noticeOn)
        return t("customer.commercial.term.periodNotice", {
          period,
          date: date(term.noticeOn),
        });
      if (term.autoRenews)
        return t("customer.commercial.term.periodAutoRenews", { period });
      return period;
    }
    case "pendingExecution":
      return t("customer.commercial.term.pendingExecution");
    case "coterminous":
      return t("customer.commercial.term.coterminous", {
        agreement: term.agreement,
      });
    case "quote":
      if (term.expiresOn)
        return t("customer.commercial.term.quoteExpires", {
          count: term.months,
          date: date(term.expiresOn),
        });
      if (term.acceptedOn)
        return t("customer.commercial.term.quoteAccepted", {
          count: term.months,
          date: date(term.acceptedOn),
        });
      return t("customer.commercial.term.quoteUnissued", {
        count: term.months,
      });
    case "canceledBeforeAcceptance":
      return t("customer.commercial.term.canceledBeforeAcceptance");
    case "endsOn":
      return t("customer.commercial.term.endsOn", { date: date(term.on) });
    case "startsOn":
      return t("customer.commercial.term.startsOn", { date: date(term.on) });
    case "pocExpires":
      return t("customer.commercial.term.pocExpires", { date: date(term.on) });
    case "evaluationComplete":
      return t("customer.commercial.term.evaluationComplete");
    case "servicePeriod":
      return t("customer.commercial.term.servicePeriod", {
        period: formatDateRange(term.start, term.end, locale),
      });
  }
}

function descriptionText(
  facts: CommercialFacts,
  fallback: string,
  t: Translator,
): string {
  const line = facts.receipt
    ? t("customer.commercial.description.achReceipt", {
        receipt: facts.receipt.reference,
        last4: facts.receipt.last4,
      })
    : (facts.description ?? fallback);
  return facts.purchaseOrder
    ? t("common.join.labels", { first: line, second: facts.purchaseOrder })
    : line;
}

/** The status chip for a record, from its status where the status is known. */
export function commercialStatusLabel(
  kind: CollectionKind,
  status: string,
  t: Translator,
): string | undefined {
  const id = statusLabels[kind][status];
  return id ? t(id) : undefined;
}

/** The parts of a record `commercialDisplay` reads. */
export type CommercialDisplaySource = Pick<
  CommercialRecord,
  | "id"
  | "kind"
  | "status"
  | "updatedAt"
  | "description"
  | "statusLabel"
  | "value"
  | "valueLabel"
  | "dateLabel"
  | "term"
  | "nextAction"
  | "nextActionHref"
  | "facts"
>;

function text(data: Readonly<Record<string, unknown>>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

/**
 * The same rendering for a raw projection row, for readers that hold the
 * projection data rather than a loaded `CommercialRecord` (the acceptance
 * page's quote selection; any projection consumer that wants the facts
 * rendered). Missing display strings read as empty.
 */
export function projectionDisplay(
  data: Readonly<Record<string, unknown>>,
  kind: CollectionKind,
  updatedAt: string,
  t: Translator,
  locale: string,
): CommercialDisplay {
  const facts = readCommercialFacts(data.facts);
  return commercialDisplay(
    {
      id: text(data, "id"),
      kind,
      status: text(data, "status"),
      updatedAt,
      description: text(data, "description"),
      statusLabel: text(data, "statusLabel"),
      value: text(data, "value"),
      valueLabel: text(data, "valueLabel"),
      dateLabel: text(data, "dateLabel"),
      term: text(data, "term"),
      nextAction: text(data, "nextAction"),
      ...(facts ? { facts } : {}),
    },
    t,
    locale,
  );
}

/**
 * Whether a writer after the fixture replaced one of its display strings.
 *
 * The fixture's own strings are the English rendering of its facts
 * (`projection-compat.ts`). A demo action that later writes its own string --
 * the taxed invoice total, "Paid · demo sandbox", "Accepted · order created"
 * -- is newer than the facts, so that string is shown as written; the facts
 * no longer describe that field.
 */
function rewritten(
  record: CommercialDisplaySource,
  fields: readonly (keyof ProjectionCompatStrings)[],
): boolean {
  const authored = projectionCompat[record.id];
  if (!authored) return false;
  return fields.some((field) => {
    const shown = field === "dateLabel" ? record.dateLabel : record[field];
    return shown !== authored[field];
  });
}

/**
 * Renders a record for one reader.
 *
 * Facts describe the status they were written for. A demo projection action
 * can move the record to another status; when it does and writes no label of
 * its own, the status chip and the next action follow the new status, the
 * timing becomes the record's update date, and the rest of the facts (the
 * amount, the term, the context line) still stand. Any display string a later
 * writer did replace is shown as that writer left it.
 */
export function commercialDisplay(
  record: CommercialDisplaySource,
  t: Translator,
  locale: string,
): CommercialDisplay {
  const trackOrder = record.nextActionHref
    ? t("customer.commercial.next.trackOrder")
    : undefined;
  const facts = record.facts;
  if (!facts)
    return {
      description: record.description,
      statusLabel: record.statusLabel,
      value: record.value,
      valueLabel: record.valueLabel,
      timing: record.dateLabel,
      term: record.term,
      nextAction: trackOrder ?? record.nextAction,
      valueSort: null,
    };
  const current = facts.status === record.status;
  const statusLabel = rewritten(record, ["statusLabel"])
    ? record.statusLabel
    : (commercialStatusLabel(record.kind, record.status, t) ??
      record.statusLabel);
  const timing = rewritten(record, ["dateLabel"])
    ? record.dateLabel
    : current
      ? t(timingMessages[facts.timing.kind], {
          date: formatDate(facts.timing.on, locale),
        })
      : t("customer.commercial.timing.updated", {
          date: formatDate(record.updatedAt.slice(0, 10), locale),
        });
  const moved = actionNext[record.kind][record.status];
  const nextAction =
    trackOrder ??
    (rewritten(record, ["nextAction"])
      ? record.nextAction
      : current
        ? t(
            nextMessages[facts.next.kind],
            facts.next.on ? { date: formatDate(facts.next.on, locale) } : {},
          )
        : moved
          ? t(moved)
          : record.status === "complete"
            ? t("customer.commercial.next.noFurtherAction")
            : record.nextAction);
  const valueRewritten = rewritten(record, ["value", "valueLabel"]);
  return {
    description: rewritten(record, ["description"])
      ? record.description
      : descriptionText(facts, record.description, t),
    statusLabel,
    value: valueRewritten ? record.value : valueText(facts.value, t, locale),
    valueLabel: valueRewritten
      ? record.valueLabel
      : t(valueLabels[facts.valueLabel]),
    timing,
    term: rewritten(record, ["term"])
      ? record.term
      : termText(facts.term, t, locale),
    nextAction,
    valueSort: valueRewritten ? null : valueSort(facts.value),
  };
}
