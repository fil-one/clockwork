import {
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";
import type { MessageId, Translator } from "@/src/i18n";

import type { ProjectionRecord } from "./model";
import { actionLabel } from "./projection-action-labels";

/**
 * Production projection labels in the reader's language.
 *
 * The materializer (`packages/workflows/src/experience/projection-presentation.ts`)
 * writes English display strings and US-format dates into every projection
 * row, and those rows are persisted. Rewriting the write path would change a
 * stored format and leave every existing row English until it was
 * re-materialized. It does not need to change: each row also persists the
 * allowlisted aggregate payload it was built from, under `authoritative`, plus
 * the closed-set `status` and the `allowedActions`. This module re-derives the
 * same labels from those facts at read time, with the reader's translator and
 * formatting locale, and the stored strings remain the fallback for a row that
 * carries no facts.
 *
 * It mirrors `describeAggregate` field for field: the same facts, the same
 * absence rules, the same overdue thresholds. Relative dates are computed
 * against the read time rather than the event time the row was projected at,
 * which is what the stored "N days remaining" was meant to say anyway.
 *
 * Only the database projection source goes through here. Demo records are
 * localized by the demo source from their own fixtures.
 */
export interface DisplayContext {
  readonly t: Translator;
  /** The reader's formatting tag (`formattingLocales[locale]`). */
  readonly locale: string;
  readonly now: Date;
}

type Facts = Readonly<Record<string, unknown>>;

interface Display {
  title?: string;
  description: string;
  context: readonly { label: string; value: string }[];
  value: string;
  valueLabel: string;
  secondary: string;
  term: string;
  dateLabel: string;
  overdue: boolean;
}

const publicStatuses: Readonly<Record<string, MessageId>> = {
  active: "status.active",
  attention: "status.attention",
  draft: "status.draft",
  open: "status.open",
  accepted: "status.accepted",
  canceled: "status.canceled",
  pending: "status.pending",
  paid: "status.paid",
  blocked: "status.blocked",
  complete: "status.complete",
};

const quoteStatuses: Readonly<Record<string, MessageId>> = {
  draft: "status.quote.draft",
  pending_exception: "status.pending",
  issued: "status.quote.issued",
  accepted: "status.quote.accepted",
  expired: "status.quote.expired",
  superseded: "status.quote.superseded",
  rejected: "status.quote.rejected",
};

const floorResults: Readonly<Record<string, MessageId>> = {
  not_configured: "experience.display.floor.notConfigured",
  pass: "experience.display.floor.pass",
  exception_required: "experience.display.floor.exceptionRequired",
  approved: "experience.display.floor.approved",
  rejected: "experience.display.floor.rejected",
};

const routes: Readonly<Record<string, MessageId>> = {
  direct: "experience.display.route.direct",
  referral: "experience.display.route.referral",
  resale: "experience.display.route.resale",
  reseller: "experience.display.route.resale",
  distributor: "experience.display.route.distributor",
  marketplace: "experience.display.route.marketplace",
};

const papers: Readonly<Record<string, MessageId>> = {
  ours: "experience.display.paper.ours",
  theirs: "experience.display.paper.theirs",
};

const renewalTypes: Readonly<Record<string, MessageId>> = {
  auto_renew: "experience.display.renewal.auto",
  expires: "experience.display.renewal.expires",
};

const executionModes: Readonly<Record<string, MessageId>> = {
  click_through: "experience.display.execution.clickThrough",
  counter_signed: "experience.display.execution.counterSigned",
};

const amendmentKinds: Readonly<Record<string, MessageId>> = {
  upgrade: "experience.display.amendment.upgrade",
  downgrade: "experience.display.amendment.downgrade",
  term_extension: "experience.display.amendment.termExtension",
  co_termination: "experience.display.amendment.coTermination",
  mixed: "experience.display.amendment.mixed",
};

const finalBillingStatuses: Readonly<Record<string, MessageId>> = {
  pending: "experience.display.finalBilling.pending",
  settled: "experience.display.finalBilling.settled",
  credit_due: "experience.display.finalBilling.creditDue",
};

const exceptionQueues: Readonly<Record<string, MessageId>> = {
  pricing: "experience.display.queue.pricing",
  legal: "experience.display.queue.legal",
  credit_collections: "experience.display.queue.creditCollections",
  restricted_parties: "experience.display.queue.restrictedParties",
  disputes: "experience.display.queue.disputes",
  deal_registration_disputes:
    "experience.display.queue.dealRegistrationDisputes",
  poc_qualification: "experience.display.queue.pocQualification",
  provisioning_recovery: "experience.display.queue.provisioningRecovery",
  migration_review: "experience.display.queue.migrationReview",
  offboarding_destructive: "experience.display.queue.offboardingDestructive",
  order_acceptance_review: "experience.display.queue.orderAcceptanceReview",
  billing_operations: "experience.display.queue.billingOperations",
  commissions: "experience.display.queue.commissions",
  reconciliation: "experience.display.queue.reconciliation",
  reporting: "experience.display.queue.reporting",
  workflow_operations: "experience.display.queue.workflowOperations",
};

const recordKinds: Readonly<Record<string, MessageId>> = {
  account: "recordKind.account",
  agreement: "recordKind.agreement",
  quote: "recordKind.quote",
  order: "recordKind.order",
  amendment: "recordKind.amendment",
  poc: "recordKind.poc",
  invoice: "recordKind.invoice",
  commission_statement: "recordKind.commissionStatement",
};

const operations: Readonly<Record<string, MessageId>> = {
  provision: "experience.display.operation.provision",
  upgrade_poc: "experience.display.operation.upgradePoc",
  sandbox: "experience.display.operation.sandbox",
  teardown: "experience.display.operation.teardown",
};

const reports: Readonly<Record<string, MessageId>> = {
  revenue_forecast: "experience.display.report.revenueForecast",
  capacity_planning: "experience.display.report.capacityPlanning",
  renewal_churn_exposure: "experience.display.report.renewalChurn",
  partner_performance: "experience.display.report.partnerPerformance",
  funnel_cycle_time: "experience.display.report.funnelCycleTime",
  margin_poc_cost: "experience.display.report.marginPocCost",
  weekly_scorecard: "experience.display.report.weeklyScorecard",
};

const reportStatuses: Readonly<Record<string, MessageId>> = {
  pending: "status.pending",
  running: "status.inProgress",
  complete: "status.complete",
  failed: "status.failed",
};

const relationshipRoles: Readonly<Record<string, MessageId>> = {
  direct_client: "experience.display.role.directClient",
  partner: "experience.display.role.partner",
  end_client: "experience.display.role.endClient",
};

const screeningStatuses: Readonly<Record<string, MessageId>> = {
  pending: "experience.display.screening.pending",
  clear: "experience.display.screening.clear",
  review: "experience.display.screening.review",
  blocked: "experience.display.screening.blocked",
};

const statementStatuses: Readonly<Record<string, MessageId>> = {
  draft: "status.draft",
  issued: "status.issued",
  approved: "status.approved",
  exported: "experience.display.statement.exported",
  paid: "status.paid",
  void: "experience.display.statement.void",
};

function text(facts: Facts, key: string): string | null {
  const value = facts[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function integer(facts: Facts, key: string): number | null {
  const value = facts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A value from a domain enum in the reader's words. A value the product has
 * not named yet is shown as the identifier it is, spaced, so a new domain
 * value is visible rather than silently dropped.
 */
function named(
  labels: Readonly<Record<string, MessageId>>,
  value: string,
  t: Translator,
): string {
  const id = labels[value];
  return id ? t(id) : value.replaceAll("_", " ");
}

function instant(value: string | null): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function day(value: string | null, context: DisplayContext): string | null {
  const date = instant(value);
  return date
    ? new Intl.DateTimeFormat(context.locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date)
    : null;
}

function range(
  start: string | null,
  end: string | null,
  context: DisplayContext,
): string | null {
  const from = instant(start);
  const to = instant(end);
  if (!from || !to) return null;
  return new Intl.DateTimeFormat(context.locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).formatRange(from, to);
}

function daysUntil(value: string | null, now: Date): number | null {
  const date = instant(value);
  return date
    ? Math.round((date.getTime() - now.getTime()) / 86_400_000)
    : null;
}

function money(
  minorUnits: string | null,
  currency: string | null,
  context: DisplayContext,
): string | null {
  if (!minorUnits || !/^-?\d+$/.test(minorUnits)) return null;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  return formatMoney(minorUnits, currency as SupportedCurrency, context.locale);
}

type Countdown = "expires" | "due" | "ends" | "target" | "requested";

const countdownMessages: Readonly<
  Record<Countdown, { future: MessageId; past: MessageId; none: MessageId }>
> = {
  expires: {
    future: "experience.display.expires.future",
    past: "experience.display.expires.past",
    none: "experience.display.expires.none",
  },
  due: {
    future: "experience.display.due",
    past: "experience.display.due",
    none: "experience.display.due.none",
  },
  ends: {
    future: "experience.display.ends.future",
    past: "experience.display.ends.past",
    none: "experience.display.ends.none",
  },
  target: {
    future: "experience.display.target",
    past: "experience.display.target",
    none: "experience.display.target.none",
  },
  requested: {
    future: "experience.display.requested",
    past: "experience.display.requested",
    none: "experience.display.requested.none",
  },
};

/** "Expires 23 sept. 2026 · dans 3 jours", with Intl choosing "today" and the plural. */
function countdown(
  value: string | null,
  kind: Countdown,
  context: DisplayContext,
): string {
  const messages = countdownMessages[kind];
  const date = day(value, context);
  const days = daysUntil(value, context.now);
  if (!date || days === null) return context.t(messages.none);
  return context.t(days < 0 ? messages.past : messages.future, {
    date,
    relative: new Intl.RelativeTimeFormat(context.locale, {
      numeric: "auto",
    }).format(days, "day"),
  });
}

function join(context: DisplayContext, first: string, second: string): string {
  return context.t("common.join.labels", { first, second });
}

function describe(
  aggregateType: string,
  facts: Facts,
  sourceUpdatedAt: string,
  context: DisplayContext,
): Display {
  const { t } = context;
  const notRecorded = t("common.notRecorded");
  const currency = text(facts, "currency");
  const status = text(facts, "status");
  const updated = day(sourceUpdatedAt, context) ?? notRecorded;
  /** The record identifier the materializer put in the title, if any. */
  const reference = text(facts, "__reference");
  const titled = (suffix: string | null) =>
    reference && suffix ? { title: join(context, reference, suffix) } : {};

  switch (aggregateType) {
    case "quote": {
      const revision = integer(facts, "revision");
      const expiresAt = text(facts, "expiresAt");
      const expiryDays = daysUntil(expiresAt, context.now);
      const floor = text(facts, "marginFloorResult");
      const floorLabel = floor ? named(floorResults, floor, t) : null;
      return {
        ...(reference && revision
          ? {
              title: t("experience.display.quoteTitle", {
                reference,
                revision,
              }),
            }
          : {}),
        description:
          status === "issued"
            ? countdown(expiresAt, "expires", context)
            : join(
                context,
                t("recordKind.quote"),
                named(quoteStatuses, status ?? "draft", t),
              ),
        context: [
          ...(floorLabel
            ? [
                {
                  label: t("experience.display.label.floorCheck"),
                  value: floorLabel,
                },
              ]
            : []),
          ...(expiresAt
            ? [
                {
                  label: t("experience.display.label.expires"),
                  value: day(expiresAt, context) ?? expiresAt,
                },
              ]
            : []),
          {
            label: t("experience.display.label.revision"),
            value: String(revision ?? 1),
          },
        ],
        value:
          money(text(facts, "totalMinor"), currency, context) ?? notRecorded,
        valueLabel: currency
          ? t("experience.display.totalCurrency", { currency })
          : t("common.total"),
        secondary: floorLabel
          ? t("experience.display.floorResult", { result: floorLabel })
          : t("experience.display.revisionNumber", { revision: revision ?? 1 }),
        term: countdown(expiresAt, "expires", context),
        dateLabel: day(expiresAt, context) ?? updated,
        overdue: status === "issued" && expiryDays !== null && expiryDays <= 3,
      };
    }

    case "order": {
      const startsOn = text(facts, "serviceStartsOn");
      const noticeOn = text(facts, "noticeOn");
      const sourcing = text(facts, "sourcing");
      const route = sourcing ? named(routes, sourcing, t) : null;
      const term =
        range(startsOn, text(facts, "serviceEndsOn"), context) ??
        t("experience.display.termNotSet");
      const noticeDays = daysUntil(noticeOn, context.now);
      return {
        description: join(
          context,
          route
            ? join(context, t("recordKind.order"), route)
            : t("recordKind.order"),
          term,
        ),
        context: [
          ...(route
            ? [{ label: t("experience.display.label.route"), value: route }]
            : []),
          { label: t("experience.detail.fact.serviceTerm"), value: term },
          ...(noticeOn
            ? [
                {
                  label: t("experience.display.label.notice"),
                  value: day(noticeOn, context) ?? noticeOn,
                },
              ]
            : []),
        ],
        value: term,
        valueLabel: t("experience.detail.fact.serviceTerm"),
        secondary: route ?? t("experience.display.route.direct"),
        term,
        dateLabel: day(startsOn, context) ?? notRecorded,
        overdue: noticeDays !== null && noticeDays >= 0 && noticeDays <= 30,
      };
    }

    case "invoice": {
      const dueAt = text(facts, "dueAt");
      const paidAt = text(facts, "paidAt");
      const dueDays = daysUntil(dueAt, context.now);
      const paid = paidAt
        ? t("experience.display.paidOn", {
            date: day(paidAt, context) ?? paidAt,
          })
        : null;
      const due = countdown(dueAt, "due", context);
      return {
        description: paid ?? due,
        context: [
          ...(dueAt
            ? [
                {
                  label: t("experience.display.label.due"),
                  value: day(dueAt, context) ?? dueAt,
                },
              ]
            : []),
          ...(paidAt
            ? [
                {
                  label: t("experience.display.label.paid"),
                  value: day(paidAt, context) ?? paidAt,
                },
              ]
            : []),
        ],
        value:
          money(text(facts, "amountMinor"), currency, context) ?? notRecorded,
        valueLabel: currency
          ? t("experience.display.amountCurrency", { currency })
          : t("common.amount"),
        secondary: paidAt ? t("status.invoice.paid") : due,
        term: paid ?? due,
        dateLabel: day(dueAt, context) ?? notRecorded,
        overdue: !paidAt && dueDays !== null && dueDays < 0,
      };
    }

    case "commission_statement": {
      const period =
        range(
          text(facts, "periodStartsOn"),
          text(facts, "periodEndsOn"),
          context,
        ) ?? t("experience.display.periodNotRecorded");
      const settlement = join(
        context,
        t("recordKind.commissionStatement"),
        named(statementStatuses, status ?? "draft", t),
      );
      const amount = (key: string) =>
        money(text(facts, key), currency, context) ?? notRecorded;
      return {
        ...titled(period),
        description: join(
          context,
          t("experience.display.statementLines", {
            count: integer(facts, "lineCount") ?? 0,
          }),
          settlement,
        ),
        context: [
          { label: t("experience.display.label.period"), value: period },
          ...(text(facts, "clawbackMinor")
            ? [
                {
                  label: t("experience.display.label.clawbacks"),
                  value: amount("clawbackMinor"),
                },
              ]
            : []),
          ...(text(facts, "holdbackMinor")
            ? [
                {
                  label: t("experience.display.label.holdback"),
                  value: amount("holdbackMinor"),
                },
              ]
            : []),
          ...(text(facts, "payableMinor")
            ? [
                {
                  label: t("experience.display.label.payable"),
                  value: amount("payableMinor"),
                },
              ]
            : []),
        ],
        value: amount("grossAccruedMinor"),
        valueLabel: currency
          ? t("experience.display.accruedCurrency", { currency })
          : t("experience.display.accrued"),
        secondary: settlement,
        term: settlement,
        dateLabel: updated,
        overdue: false,
      };
    }

    case "agreement": {
      const effectiveOn = text(facts, "effectiveOn");
      const termMonths = integer(facts, "termMonths");
      const noticeDays = integer(facts, "noticeDays");
      const renewalType = text(facts, "renewalType");
      const paper = text(facts, "paper");
      const executionMode = text(facts, "executionMode");
      const termLabel = termMonths
        ? t("experience.display.termMonths", { count: termMonths })
        : t("experience.display.termNotSet");
      const renewal = renewalType ? named(renewalTypes, renewalType, t) : null;
      return {
        description: paper
          ? join(context, named(papers, paper, t), termLabel)
          : termLabel,
        context: [
          ...(effectiveOn
            ? [
                {
                  label: t("experience.display.label.effective"),
                  value: day(effectiveOn, context) ?? effectiveOn,
                },
              ]
            : []),
          ...(renewal
            ? [{ label: t("experience.display.label.renewal"), value: renewal }]
            : []),
          ...(noticeDays !== null
            ? [
                {
                  label: t("experience.display.label.noticeWindow"),
                  value: t("experience.display.days", { count: noticeDays }),
                },
              ]
            : []),
          ...(executionMode
            ? [
                {
                  label: t("experience.display.label.execution"),
                  value: named(executionModes, executionMode, t),
                },
              ]
            : []),
        ],
        value: termLabel,
        valueLabel: t("experience.detail.fact.term"),
        secondary: renewal ?? t("recordKind.agreement"),
        term: effectiveOn
          ? join(
              context,
              t("experience.display.effectiveFrom", {
                date: day(effectiveOn, context) ?? effectiveOn,
              }),
              termLabel,
            )
          : termLabel,
        dateLabel: day(effectiveOn, context) ?? notRecorded,
        overdue: false,
      };
    }

    case "poc": {
      const expiresAt = text(facts, "expiresAt");
      const capacityCap = text(facts, "capacityCap");
      const finalReportAt = text(facts, "finalReportAt");
      const expiryDays = daysUntil(expiresAt, context.now);
      const expires = countdown(expiresAt, "expires", context);
      return {
        description: expires,
        context: [
          ...(capacityCap
            ? [
                {
                  label: t("experience.display.label.capacityCap"),
                  value: capacityCap,
                },
              ]
            : []),
          ...(expiresAt
            ? [
                {
                  label: t("experience.display.label.expires"),
                  value: day(expiresAt, context) ?? expiresAt,
                },
              ]
            : []),
          ...(finalReportAt
            ? [
                {
                  label: t("experience.display.label.finalReport"),
                  value: day(finalReportAt, context) ?? finalReportAt,
                },
              ]
            : []),
        ],
        value: capacityCap ?? notRecorded,
        valueLabel: t("experience.display.label.capacityCap"),
        secondary: expires,
        term: expires,
        dateLabel: day(expiresAt, context) ?? notRecorded,
        overdue: expiryDays !== null && expiryDays >= 0 && expiryDays <= 7,
      };
    }

    case "amendment": {
      const effectiveOn = text(facts, "effectiveOn");
      const kind = text(facts, "kind");
      const change = kind
        ? named(amendmentKinds, kind, t)
        : t("recordKind.amendment");
      const effective = day(effectiveOn, context);
      const when = effective
        ? t("experience.display.effectiveFrom", { date: effective })
        : t("experience.display.effectiveOnApproval");
      return {
        description: join(context, change, when),
        context: [
          ...(kind
            ? [{ label: t("experience.display.label.kind"), value: change }]
            : []),
          ...(effectiveOn
            ? [
                {
                  label: t("experience.display.label.effective"),
                  value: effective ?? effectiveOn,
                },
              ]
            : []),
        ],
        value: change,
        valueLabel: t("experience.display.label.change"),
        secondary: effective ?? t("status.pending"),
        term: when,
        dateLabel: effective ?? notRecorded,
        overdue: false,
      };
    }

    case "termination": {
      const effectiveAt = text(facts, "effectiveAt");
      const teardownStatus = text(facts, "teardownStatus");
      const finalBillingStatus = text(facts, "finalBillingStatus");
      const ends = countdown(effectiveAt, "ends", context);
      // Teardown states are written by the lifecycle repository and have no
      // closed list yet, so they are shown as recorded.
      const teardown = teardownStatus?.replaceAll("_", " ") ?? null;
      return {
        description: ends,
        context: [
          ...(finalBillingStatus
            ? [
                {
                  label: t("experience.display.label.finalBilling"),
                  value: named(finalBillingStatuses, finalBillingStatus, t),
                },
              ]
            : []),
          ...(teardown
            ? [
                {
                  label: t("experience.display.label.teardown"),
                  value: teardown,
                },
              ]
            : []),
        ],
        value: day(effectiveAt, context) ?? notRecorded,
        valueLabel: t("experience.display.label.effective"),
        secondary: teardown ?? t("status.pending"),
        term: ends,
        dateLabel: day(effectiveAt, context) ?? notRecorded,
        overdue: false,
      };
    }

    case "exception_case": {
      const queue = text(facts, "queue");
      const targetAt = text(facts, "targetAt");
      const objectType = text(facts, "objectType");
      const targetDays = daysUntil(targetAt, context.now);
      const queueLabel = queue ? named(exceptionQueues, queue, t) : null;
      const target = countdown(targetAt, "target", context);
      return {
        ...titled(queueLabel),
        description: target,
        context: [
          ...(queueLabel
            ? [
                {
                  label: t("experience.display.label.queue"),
                  value: queueLabel,
                },
              ]
            : []),
          ...(objectType
            ? [
                {
                  label: t("experience.display.label.subject"),
                  value: named(recordKinds, objectType, t),
                },
              ]
            : []),
          ...(targetAt
            ? [
                {
                  label: t("experience.display.label.target"),
                  value: day(targetAt, context) ?? targetAt,
                },
              ]
            : []),
        ],
        value: queueLabel ?? t("experience.display.label.queue"),
        valueLabel: t("experience.display.label.queue"),
        secondary: target,
        term: target,
        dateLabel: day(targetAt, context) ?? notRecorded,
        overdue: targetDays !== null && targetDays < 0,
      };
    }

    case "approval": {
      const action = text(facts, "action");
      const requestedAt = text(facts, "requestedAt");
      const decidedAt = text(facts, "decidedAt");
      const actionText = action ? actionLabel(action, t) : null;
      const decided = decidedAt
        ? t("experience.display.decided", {
            date: day(decidedAt, context) ?? decidedAt,
          })
        : null;
      return {
        ...titled(actionText),
        description: decided ?? countdown(requestedAt, "requested", context),
        context: [
          ...(actionText
            ? [
                {
                  label: t("experience.display.label.action"),
                  value: actionText,
                },
              ]
            : []),
          ...(requestedAt
            ? [
                {
                  label: t("experience.display.label.requested"),
                  value: day(requestedAt, context) ?? requestedAt,
                },
              ]
            : []),
        ],
        value: actionText ?? t("experience.display.label.action"),
        valueLabel: t("experience.display.label.action"),
        secondary: decided ?? t("experience.display.awaitingDecision"),
        term: decided ?? t("experience.display.awaitingDecision"),
        dateLabel: day(requestedAt, context) ?? notRecorded,
        overdue: false,
      };
    }

    case "provider_operation": {
      // Provider names ("stripe", "docusign") are proper nouns and stay as
      // the materializer cased them; they are not translated.
      const provider = text(facts, "provider");
      const operation = text(facts, "operation");
      const attempt = integer(facts, "attemptCount") ?? 1;
      const nextAttemptAt = text(facts, "nextAttemptAt");
      const operationLabel = operation
        ? named(operations, operation, t)
        : t("experience.display.label.operation");
      const attemptLabel = t("experience.display.attempt", { attempt });
      return {
        ...titled(operation ? operationLabel : null),
        description: provider
          ? join(context, providerName(provider), attemptLabel)
          : attemptLabel,
        context: [
          ...(provider
            ? [
                {
                  label: t("experience.display.label.provider"),
                  value: providerName(provider),
                },
              ]
            : []),
          {
            label: t("experience.display.label.attempts"),
            value: String(attempt),
          },
          ...(nextAttemptAt
            ? [
                {
                  label: t("experience.display.label.nextAttempt"),
                  value: day(nextAttemptAt, context) ?? nextAttemptAt,
                },
              ]
            : []),
        ],
        value: operationLabel,
        valueLabel: t("experience.display.label.operation"),
        secondary: attemptLabel,
        term: nextAttemptAt
          ? t("experience.display.retries", {
              date: day(nextAttemptAt, context) ?? nextAttemptAt,
            })
          : t("experience.display.noRetry"),
        dateLabel: day(nextAttemptAt, context) ?? notRecorded,
        overdue: attempt > 3,
      };
    }

    case "report_export": {
      const report = text(facts, "report");
      const reportLabel = report ? named(reports, report, t) : null;
      const exportStatus = t("experience.display.exportStatus", {
        status: named(reportStatuses, status ?? "pending", t),
      });
      return {
        ...(reportLabel ? { title: reportLabel } : {}),
        description: exportStatus,
        context: reportLabel
          ? [
              {
                label: t("experience.display.label.report"),
                value: reportLabel,
              },
            ]
          : [],
        value: reportLabel ?? t("experience.display.label.report"),
        valueLabel: t("experience.display.label.report"),
        secondary: named(reportStatuses, status ?? "pending", t),
        term: exportStatus,
        dateLabel: updated,
        overdue: false,
      };
    }

    case "account": {
      const country = text(facts, "country");
      const screening = text(facts, "screeningStatus");
      const partnerType = text(facts, "partnerAgreementType");
      const roles = Array.isArray(facts.relationshipRoles)
        ? facts.relationshipRoles.filter(
            (role): role is string => typeof role === "string",
          )
        : [];
      const relationship = roles.length
        ? new Intl.ListFormat(context.locale, { type: "conjunction" }).format(
            roles.map((role) => named(relationshipRoles, role, t)),
          )
        : null;
      const countryName = country ? regionName(country, context) : null;
      return {
        description: relationship ?? t("experience.display.commercialAccount"),
        context: [
          ...(countryName
            ? [
                {
                  label: t("experience.display.label.country"),
                  value: countryName,
                },
              ]
            : []),
          ...(currency
            ? [{ label: t("common.currency"), value: currency }]
            : []),
          ...(partnerType
            ? [
                {
                  label: t("experience.display.label.partnerType"),
                  value: named(routes, partnerType, t),
                },
              ]
            : []),
        ],
        value: relationship ?? t("recordKind.account"),
        valueLabel: t("experience.display.label.relationship"),
        secondary: countryName ?? t("recordKind.account"),
        term: screening
          ? t("experience.display.screening", {
              status: named(screeningStatuses, screening, t),
            })
          : t("recordKind.account"),
        dateLabel: updated,
        overdue: screening === "blocked",
      };
    }

    default: {
      const type = named(recordKinds, aggregateType, t);
      return {
        description: t("experience.display.recordOfType", { type }),
        context: [],
        value: notRecorded,
        valueLabel: type,
        secondary: type,
        term: type,
        dateLabel: updated,
        overdue: false,
      };
    }
  }
}

/** "stripe" is written the way its owner writes it; unknown names as stored. */
function providerName(value: string): string {
  const known: Readonly<Record<string, string>> = {
    stripe: "Stripe",
    docusign: "DocuSign",
    workos: "WorkOS",
    aws: "AWS",
    azure: "Microsoft Azure", // i18n-exempt: vendor product name, written as the vendor writes it
    gcp: "Google Cloud",
    google_cloud: "Google Cloud",
    supabase: "Supabase",
    netlify: "Netlify",
  };
  return known[value.toLowerCase()] ?? value;
}

/** ISO 3166 codes named in the reader's language ("DE" → "Alemania"). */
function regionName(code: string, context: DisplayContext): string {
  try {
    return (
      new Intl.DisplayNames(context.locale, { type: "region" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

function factsOf(record: ProjectionRecord): Facts | null {
  const value = record.data.authoritative;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Facts)
    : null;
}

function allowedActions(record: ProjectionRecord): readonly string[] {
  return Array.isArray(record.data.allowedActions)
    ? record.data.allowedActions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
}

/**
 * The same row with its display fields rendered for this reader. A row with no
 * `authoritative` facts (older than the facts, or written by something other
 * than the materializer) is returned unchanged.
 */
export function localizedProductionRecord(
  record: ProjectionRecord,
  context: DisplayContext,
): ProjectionRecord {
  const facts = factsOf(record);
  if (!facts) return record;
  const reference =
    typeof record.data.reference === "string" ? record.data.reference : null;
  const display = describe(
    record.aggregateType,
    reference ? { ...facts, __reference: reference } : facts,
    record.sourceUpdatedAt,
    context,
  );
  const actions = allowedActions(record);
  const status =
    typeof record.data.status === "string" ? record.data.status : "";
  const statusId = publicStatuses[status];
  const title = display.title;
  return {
    ...record,
    data: {
      ...record.data,
      ...(title ? { title, name: title } : {}),
      description: display.description,
      context: display.context,
      ...(statusId ? { statusLabel: context.t(statusId) } : {}),
      value: display.value,
      valueLabel: display.valueLabel,
      secondary: display.secondary,
      dateLabel: display.dateLabel,
      term: display.term,
      nextAction:
        actions.length > 0
          ? actionLabel(actions[0] as string, context.t)
          : display.overdue
            ? context.t("status.review")
            : context.t("experience.display.readOnly"),
    },
  };
}

const acceptedOrderHref = /^\/orders\/order-[0-9a-f-]+$/u;

/**
 * A demo quote the reader accepted into an order.
 *
 * The acceptance writes facts -- `status: "accepted"`, the order link and
 * `acceptedOrder: { orderId, reference }` -- and this renders the status and
 * the next step from them for whoever is reading. Overrides written before the
 * facts existed carry English sentences and the same link; they are recognised
 * by the link and rendered the same way, without the purchase-order number
 * that only their English sentence held.
 */
export function localizedAcceptedOrderRecord(
  record: ProjectionRecord,
  t: Translator,
): ProjectionRecord {
  const data = record.data;
  if (
    data.status !== "accepted" ||
    typeof data.nextActionHref !== "string" ||
    !acceptedOrderHref.test(data.nextActionHref)
  )
    return record;
  const fact = data.acceptedOrder;
  const reference =
    fact &&
    typeof fact === "object" &&
    !Array.isArray(fact) &&
    typeof (fact as { reference?: unknown }).reference === "string" &&
    ((fact as { reference: string }).reference.trim() || null);
  return {
    ...record,
    data: {
      ...data,
      statusLabel: t("experience.order.acceptedStatus"),
      nextAction: reference
        ? t("experience.order.track", { reference })
        : t("experience.order.trackWithoutReference"),
    },
  };
}
