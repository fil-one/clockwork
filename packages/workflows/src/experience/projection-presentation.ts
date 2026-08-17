import type { AuthoritativeProjectionState } from "./projection-materializer";

/**
 * Display derivation for portal projections.
 *
 * The authoritative payload deliberately excludes names, contacts and
 * addresses, so every label here is built from identifiers, statuses, dates and
 * amounts. Nothing in this module reads a projection table.
 */

export type PublicStatus =
  | "active"
  | "attention"
  | "draft"
  | "open"
  | "accepted"
  | "canceled"
  | "pending"
  | "paid"
  | "blocked"
  | "complete";

/**
 * Shown wherever an aggregate has no amount or date to report. The dashboard
 * suppresses a field carrying this token, so any consumer that tests for
 * absence must compare against this export rather than a copied literal.
 */
export const NOT_RECORDED = "Not recorded";

export type Tone = "neutral" | "success" | "warning" | "danger";
export type Risk = "low" | "medium" | "high";

export interface ContextEntry {
  label: string;
  value: string;
}

const currencySymbols: Readonly<Record<string, string>> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function text(state: AuthoritativeProjectionState, key: string): string | null {
  const value = state.data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function integer(
  state: AuthoritativeProjectionState,
  key: string,
): number | null {
  const value = state.data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Minor units arrive as exact decimal strings and never become floats here. */
export function formatMoney(
  minorUnits: string | null,
  currency: string | null,
): string | null {
  if (!minorUnits || !/^-?\d+$/.test(minorUnits)) return null;
  const negative = minorUnits.startsWith("-");
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(3, "0");
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const symbol = currency ? (currencySymbols[currency] ?? "") : "";
  const suffix = currency && !symbol ? ` ${currency}` : "";
  return `${negative ? "-" : ""}${symbol}${grouped}.${fraction}${suffix}`;
}

function minorUnitsToNumber(minorUnits: string | null): number {
  if (!minorUnits || !/^-?\d+$/.test(minorUnits)) return 0;
  const parsed = Number(minorUnits);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function reference(prefix: string, aggregateId: string): string {
  return `${prefix}-${aggregateId.slice(0, 8).toUpperCase()}`;
}

/**
 * Maps an aggregate status onto the closed set every portal loader accepts.
 * Unknown values become `attention` so a new status surfaces for review rather
 * than rendering as healthy.
 */
export function publicStatus(value: unknown): PublicStatus {
  if (typeof value !== "string") return "pending";
  if (value === "issued") return "open";
  if (["expired", "rejected", "superseded", "void", "canceled"].includes(value))
    return "canceled";
  if (["complete", "completed", "succeeded", "closed"].includes(value))
    return "complete";
  if (
    [
      "active",
      "draft",
      "accepted",
      "pending",
      "paid",
      "blocked",
      "open",
    ].includes(value)
  )
    return value as PublicStatus;
  return "attention";
}

function toneFor(status: PublicStatus, overdue: boolean): Tone {
  if (status === "blocked" || overdue) return "danger";
  if (status === "attention" || status === "pending") return "warning";
  if (status === "paid" || status === "complete" || status === "accepted")
    return "success";
  return "neutral";
}

function riskFor(status: PublicStatus, overdue: boolean): Risk {
  if (status === "blocked" || overdue) return "high";
  if (status === "attention" || status === "pending") return "medium";
  return "low";
}

export interface AggregateDisplay {
  reference: string;
  title: string;
  description: string;
  context: readonly ContextEntry[];
  value: string;
  valueSort: number;
  valueLabel: string;
  secondary: string;
  term: string;
  dateLabel: string;
  overdue: boolean;
}

function daysUntil(value: string | null, now: Date): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 86_400_000);
}

function countdown(value: string | null, now: Date, noun: string): string {
  const formatted = formatDate(value);
  if (!formatted) return `No ${noun} recorded`;
  const days = daysUntil(value, now);
  if (days === null) return `${titleCase(noun)} ${formatted}`;
  if (days < 0)
    return `${titleCase(noun)} ${formatted} · ${Math.abs(days)} days ago`;
  if (days === 0) return `${titleCase(noun)} ${formatted} · today`;
  return `${titleCase(noun)} ${formatted} · ${days} days remaining`;
}

/** Builds the per-aggregate display facts each surface renders. */
export function describeAggregate(
  state: AuthoritativeProjectionState,
  now: Date,
): AggregateDisplay {
  const currency = text(state, "currency");
  const status = text(state, "status");
  const empty: readonly ContextEntry[] = [];

  switch (state.aggregateType) {
    case "quote": {
      const revision = integer(state, "revision");
      const total = text(state, "totalMinor");
      const expiresAt = text(state, "expiresAt");
      const expiryDays = daysUntil(expiresAt, now);
      const floor = text(state, "marginFloorResult");
      const overdue =
        status === "issued" && expiryDays !== null && expiryDays <= 3;
      const identifier = reference("Q", state.aggregateId);
      return {
        reference: identifier,
        title: revision ? `${identifier} rev ${revision}` : identifier,
        description:
          status === "issued"
            ? countdown(expiresAt, now, "expires")
            : `Quote ${titleCase(status ?? "draft")}`,
        context: [
          ...(floor
            ? [{ label: "Floor check", value: titleCase(floor) }]
            : empty),
          ...(expiresAt
            ? [
                {
                  label: "Expires",
                  value: formatDate(expiresAt) ?? expiresAt,
                },
              ]
            : empty),
          { label: "Revision", value: String(revision ?? 1) },
        ],
        value: formatMoney(total, currency) ?? NOT_RECORDED,
        valueSort: minorUnitsToNumber(total),
        valueLabel: currency ? `Total ${currency}` : "Total",
        secondary: floor
          ? `Floor ${titleCase(floor)}`
          : `Revision ${revision ?? 1}`,
        term: countdown(expiresAt, now, "expires"),
        dateLabel:
          formatDate(expiresAt) ??
          formatDate(state.sourceUpdatedAt) ??
          NOT_RECORDED,
        overdue,
      };
    }

    case "order": {
      const startsOn = text(state, "serviceStartsOn");
      const endsOn = text(state, "serviceEndsOn");
      const noticeOn = text(state, "noticeOn");
      const sourcing = text(state, "sourcing");
      const identifier = reference("ORD", state.aggregateId);
      const range =
        formatDate(startsOn) && formatDate(endsOn)
          ? `${formatDate(startsOn)} – ${formatDate(endsOn)}`
          : "Term not yet set";
      const noticeDays = daysUntil(noticeOn, now);
      return {
        reference: identifier,
        title: identifier,
        description: sourcing
          ? `${titleCase(sourcing)} order · ${range}`
          : `Order · ${range}`,
        context: [
          ...(sourcing
            ? [{ label: "Sourcing", value: titleCase(sourcing) }]
            : empty),
          { label: "Service term", value: range },
          ...(noticeOn
            ? [{ label: "Notice", value: formatDate(noticeOn) ?? noticeOn }]
            : empty),
        ],
        value: range,
        valueSort: startsOn ? Date.parse(startsOn) : 0,
        valueLabel: "Service term",
        secondary: sourcing ? titleCase(sourcing) : "Direct",
        term: range,
        dateLabel: formatDate(startsOn) ?? NOT_RECORDED,
        overdue: noticeDays !== null && noticeDays >= 0 && noticeDays <= 30,
      };
    }

    case "invoice": {
      const amountMinor = text(state, "amountMinor");
      const dueAt = text(state, "dueAt");
      const paidAt = text(state, "paidAt");
      const dueDays = daysUntil(dueAt, now);
      const overdue = !paidAt && dueDays !== null && dueDays < 0;
      const identifier = reference("INV", state.aggregateId);
      return {
        reference: identifier,
        title: identifier,
        description: paidAt
          ? `Paid ${formatDate(paidAt)}`
          : countdown(dueAt, now, "due"),
        context: [
          ...(dueAt
            ? [{ label: "Due", value: formatDate(dueAt) ?? dueAt }]
            : empty),
          ...(paidAt
            ? [{ label: "Paid", value: formatDate(paidAt) ?? paidAt }]
            : empty),
        ],
        value: formatMoney(amountMinor, currency) ?? NOT_RECORDED,
        valueSort: minorUnitsToNumber(amountMinor),
        valueLabel: currency ? `Amount ${currency}` : "Amount",
        secondary: paidAt ? "Settled" : (countdown(dueAt, now, "due") ?? ""),
        term: paidAt
          ? `Paid ${formatDate(paidAt)}`
          : countdown(dueAt, now, "due"),
        dateLabel: formatDate(dueAt) ?? NOT_RECORDED,
        overdue,
      };
    }

    case "commission_statement": {
      const grossAccruedMinor = text(state, "grossAccruedMinor");
      const clawbackMinor = text(state, "clawbackMinor");
      const holdbackMinor = text(state, "holdbackMinor");
      const payableMinor = text(state, "payableMinor");
      const periodStartsOn = text(state, "periodStartsOn");
      const periodEndsOn = text(state, "periodEndsOn");
      const lineCount = integer(state, "lineCount");
      const identifier = reference("STM", state.aggregateId);
      const period =
        formatDate(periodStartsOn) && formatDate(periodEndsOn)
          ? `${formatDate(periodStartsOn)} – ${formatDate(periodEndsOn)}`
          : "Statement period not recorded";
      const settlement = `Statement ${titleCase(status ?? "draft")}`;
      return {
        reference: identifier,
        title: `${identifier} · ${period}`,
        description: `${lineCount ?? 0} collected-revenue ${lineCount === 1 ? "entry" : "entries"} · ${settlement.toLowerCase()}`,
        context: [
          { label: "Period", value: period },
          ...(clawbackMinor
            ? [
                {
                  label: "Clawbacks",
                  value: formatMoney(clawbackMinor, currency) ?? NOT_RECORDED,
                },
              ]
            : empty),
          ...(holdbackMinor
            ? [
                {
                  label: "Holdback",
                  value: formatMoney(holdbackMinor, currency) ?? NOT_RECORDED,
                },
              ]
            : empty),
          ...(payableMinor
            ? [
                {
                  label: "Payable",
                  value: formatMoney(payableMinor, currency) ?? NOT_RECORDED,
                },
              ]
            : empty),
        ],
        value: formatMoney(grossAccruedMinor, currency) ?? NOT_RECORDED,
        valueSort: minorUnitsToNumber(grossAccruedMinor),
        valueLabel: currency ? `Accrued ${currency}` : "Accrued amount",
        secondary: settlement,
        term: settlement,
        dateLabel: formatDate(state.sourceUpdatedAt) ?? NOT_RECORDED,
        overdue: false,
      };
    }

    case "agreement": {
      const effectiveOn = text(state, "effectiveOn");
      const termMonths = integer(state, "termMonths");
      const noticeDays = integer(state, "noticeDays");
      const renewalType = text(state, "renewalType");
      const paper = text(state, "paper");
      const executionMode = text(state, "executionMode");
      const identifier = reference("AGR", state.aggregateId);
      const termLabel = termMonths
        ? `${termMonths} month term`
        : "Term not yet set";
      return {
        reference: identifier,
        title: identifier,
        description: `${paper ? titleCase(paper) : "Standard"} paper · ${termLabel}`,
        context: [
          ...(effectiveOn
            ? [
                {
                  label: "Effective",
                  value: formatDate(effectiveOn) ?? effectiveOn,
                },
              ]
            : empty),
          ...(renewalType
            ? [{ label: "Renewal", value: titleCase(renewalType) }]
            : empty),
          ...(noticeDays !== null
            ? [{ label: "Notice", value: `${noticeDays} days` }]
            : empty),
          ...(executionMode
            ? [{ label: "Execution", value: titleCase(executionMode) }]
            : empty),
        ],
        value: termLabel,
        valueSort: termMonths ?? 0,
        valueLabel: "Term",
        secondary: renewalType ? titleCase(renewalType) : "Agreement",
        term: effectiveOn
          ? `Effective ${formatDate(effectiveOn)} · ${termLabel}`
          : termLabel,
        dateLabel: formatDate(effectiveOn) ?? NOT_RECORDED,
        overdue: false,
      };
    }

    case "poc": {
      const expiresAt = text(state, "expiresAt");
      const capacityCap = text(state, "capacityCap");
      const finalReportAt = text(state, "finalReportAt");
      const expiryDays = daysUntil(expiresAt, now);
      const identifier = reference("POC", state.aggregateId);
      return {
        reference: identifier,
        title: identifier,
        description: countdown(expiresAt, now, "expires"),
        context: [
          ...(capacityCap
            ? [{ label: "Capacity cap", value: capacityCap }]
            : empty),
          ...(expiresAt
            ? [{ label: "Expires", value: formatDate(expiresAt) ?? expiresAt }]
            : empty),
          ...(finalReportAt
            ? [
                {
                  label: "Final report",
                  value: formatDate(finalReportAt) ?? finalReportAt,
                },
              ]
            : empty),
        ],
        value: capacityCap ?? NOT_RECORDED,
        valueSort: expiresAt ? Date.parse(expiresAt) : 0,
        valueLabel: "Capacity cap",
        secondary: countdown(expiresAt, now, "expires"),
        term: countdown(expiresAt, now, "expires"),
        dateLabel: formatDate(expiresAt) ?? NOT_RECORDED,
        overdue: expiryDays !== null && expiryDays >= 0 && expiryDays <= 7,
      };
    }

    case "amendment": {
      const effectiveOn = text(state, "effectiveOn");
      const kind = text(state, "kind");
      const identifier = reference("AMD", state.aggregateId);
      return {
        reference: identifier,
        title: identifier,
        description: `${kind ? titleCase(kind) : "Amendment"} effective ${formatDate(effectiveOn) ?? "on approval"}`,
        context: [
          ...(kind ? [{ label: "Kind", value: titleCase(kind) }] : empty),
          ...(effectiveOn
            ? [
                {
                  label: "Effective",
                  value: formatDate(effectiveOn) ?? effectiveOn,
                },
              ]
            : empty),
        ],
        value: kind ? titleCase(kind) : "Amendment",
        valueSort: effectiveOn ? Date.parse(effectiveOn) : 0,
        valueLabel: "Change",
        secondary: formatDate(effectiveOn) ?? "Pending",
        term: `Effective ${formatDate(effectiveOn) ?? "on approval"}`,
        dateLabel: formatDate(effectiveOn) ?? NOT_RECORDED,
        overdue: false,
      };
    }

    case "termination": {
      const effectiveAt = text(state, "effectiveAt");
      const teardownStatus = text(state, "teardownStatus");
      const finalBillingStatus = text(state, "finalBillingStatus");
      const identifier = reference("TRM", state.aggregateId);
      return {
        reference: identifier,
        title: identifier,
        description: countdown(effectiveAt, now, "ends"),
        context: [
          ...(finalBillingStatus
            ? [
                {
                  label: "Final billing",
                  value: titleCase(finalBillingStatus),
                },
              ]
            : empty),
          ...(teardownStatus
            ? [{ label: "Teardown", value: titleCase(teardownStatus) }]
            : empty),
        ],
        value: formatDate(effectiveAt) ?? NOT_RECORDED,
        valueSort: effectiveAt ? Date.parse(effectiveAt) : 0,
        valueLabel: "Effective",
        secondary: teardownStatus ? titleCase(teardownStatus) : "Scheduled",
        term: countdown(effectiveAt, now, "ends"),
        dateLabel: formatDate(effectiveAt) ?? NOT_RECORDED,
        overdue: false,
      };
    }

    case "exception_case": {
      const queue = text(state, "queue");
      const targetAt = text(state, "targetAt");
      const objectType = text(state, "objectType");
      const targetDays = daysUntil(targetAt, now);
      const identifier = reference("EXC", state.aggregateId);
      return {
        reference: identifier,
        title: queue ? `${identifier} · ${titleCase(queue)}` : identifier,
        description: countdown(targetAt, now, "target"),
        context: [
          ...(queue ? [{ label: "Queue", value: titleCase(queue) }] : empty),
          ...(objectType
            ? [{ label: "Subject", value: titleCase(objectType) }]
            : empty),
          ...(targetAt
            ? [{ label: "Target", value: formatDate(targetAt) ?? targetAt }]
            : empty),
        ],
        value: queue ? titleCase(queue) : "Exception",
        valueSort: targetAt ? Date.parse(targetAt) : 0,
        valueLabel: "Queue",
        secondary: countdown(targetAt, now, "target"),
        term: countdown(targetAt, now, "target"),
        dateLabel: formatDate(targetAt) ?? NOT_RECORDED,
        overdue: targetDays !== null && targetDays < 0,
      };
    }

    case "approval": {
      const action = text(state, "action");
      const requestedAt = text(state, "requestedAt");
      const decidedAt = text(state, "decidedAt");
      const identifier = reference("APR", state.aggregateId);
      return {
        reference: identifier,
        title: action ? `${identifier} · ${titleCase(action)}` : identifier,
        description: decidedAt
          ? `Decided ${formatDate(decidedAt)}`
          : countdown(requestedAt, now, "requested"),
        context: [
          ...(action ? [{ label: "Action", value: titleCase(action) }] : empty),
          ...(requestedAt
            ? [
                {
                  label: "Requested",
                  value: formatDate(requestedAt) ?? requestedAt,
                },
              ]
            : empty),
        ],
        value: action ? titleCase(action) : "Approval",
        valueSort: requestedAt ? Date.parse(requestedAt) : 0,
        valueLabel: "Action",
        secondary: decidedAt ? "Decided" : "Awaiting decision",
        term: decidedAt
          ? `Decided ${formatDate(decidedAt)}`
          : "Awaiting decision",
        dateLabel: formatDate(requestedAt) ?? NOT_RECORDED,
        overdue: false,
      };
    }

    case "provider_operation": {
      const provider = text(state, "provider");
      const operation = text(state, "operation");
      const attemptCount = integer(state, "attemptCount");
      const nextAttemptAt = text(state, "nextAttemptAt");
      const identifier = reference("PRV", state.aggregateId);
      return {
        reference: identifier,
        title: operation
          ? `${identifier} · ${titleCase(operation)}`
          : identifier,
        description: `${provider ? titleCase(provider) : "Provider"} · attempt ${attemptCount ?? 1}`,
        context: [
          ...(provider
            ? [{ label: "Provider", value: titleCase(provider) }]
            : empty),
          { label: "Attempts", value: String(attemptCount ?? 1) },
          ...(nextAttemptAt
            ? [
                {
                  label: "Next attempt",
                  value: formatDate(nextAttemptAt) ?? nextAttemptAt,
                },
              ]
            : empty),
        ],
        value: operation ? titleCase(operation) : "Operation",
        valueSort: attemptCount ?? 0,
        valueLabel: "Operation",
        secondary: `Attempt ${attemptCount ?? 1}`,
        term: nextAttemptAt
          ? `Retries ${formatDate(nextAttemptAt)}`
          : "No retry scheduled",
        dateLabel: formatDate(nextAttemptAt) ?? NOT_RECORDED,
        overdue: (attemptCount ?? 0) > 3,
      };
    }

    case "report_export": {
      const report = text(state, "report");
      const identifier = reference("RPT", state.aggregateId);
      return {
        reference: identifier,
        title: report ? titleCase(report) : identifier,
        description: `Export ${titleCase(status ?? "pending")}`,
        context: report
          ? [{ label: "Report", value: titleCase(report) }]
          : empty,
        value: report ? titleCase(report) : "Report",
        valueSort: 0,
        valueLabel: "Report",
        secondary: titleCase(status ?? "pending"),
        term: `Export ${titleCase(status ?? "pending")}`,
        dateLabel: formatDate(state.sourceUpdatedAt) ?? NOT_RECORDED,
        overdue: false,
      };
    }

    case "account": {
      const country = text(state, "country");
      const screeningStatus = text(state, "screeningStatus");
      const partnerAgreementType = text(state, "partnerAgreementType");
      const roles = state.data.relationshipRoles;
      const roleList = Array.isArray(roles)
        ? roles.filter((role): role is string => typeof role === "string")
        : [];
      const identifier = reference("ACC", state.aggregateId);
      return {
        reference: identifier,
        title: identifier,
        description: roleList.length
          ? roleList.map(titleCase).join(", ")
          : "Commercial account",
        context: [
          ...(country ? [{ label: "Country", value: country }] : empty),
          ...(currency ? [{ label: "Currency", value: currency }] : empty),
          ...(partnerAgreementType
            ? [
                {
                  label: "Partner type",
                  value: titleCase(partnerAgreementType),
                },
              ]
            : empty),
        ],
        value: roleList.length ? roleList.map(titleCase).join(", ") : "Account",
        valueSort: 0,
        valueLabel: "Relationship",
        secondary: country ?? "Account",
        term: screeningStatus
          ? `Screening ${titleCase(screeningStatus)}`
          : "Account",
        dateLabel: formatDate(state.sourceUpdatedAt) ?? NOT_RECORDED,
        overdue: screeningStatus === "blocked",
      };
    }

    default: {
      const identifier = reference("REC", state.aggregateId);
      return {
        reference: identifier,
        title: identifier,
        description: `${titleCase(state.aggregateType)} record`,
        context: empty,
        value: NOT_RECORDED,
        valueSort: 0,
        valueLabel: titleCase(state.aggregateType),
        secondary: titleCase(state.aggregateType),
        term: titleCase(state.aggregateType),
        dateLabel: formatDate(state.sourceUpdatedAt) ?? NOT_RECORDED,
        overdue: false,
      };
    }
  }
}

export { toneFor, riskFor, daysUntil, countdown };
