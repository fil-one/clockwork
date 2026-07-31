import {
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export const renewalTaskIds = Object.freeze({
  termAlerts: "lifecycle-renewals-term-alerts-v1",
  noticeWindows: "lifecycle-renewals-notice-windows-v1",
  autoRenewEvaluation: "lifecycle-renewals-auto-renew-evaluation-v1",
});

export type RenewalEffect = WorkflowEffect<
  | "send_term_alert"
  | "alert_internal_owner"
  | "create_renewal_request"
  | "record_inbound_notice_evidence"
  | "execute_auto_renewal"
  | "open_legal_exception",
  Readonly<Record<string, unknown>>
>;

export interface TermClock {
  orderId: string;
  accountId: string;
  version: number;
  startsOn: string;
  endsOn: string;
  noticeOn: string;
  timeZone: string;
  renewalType: "auto_renew" | "expires";
  sourcing: "direct" | "referral" | "resale";
  invoicingAccountId: string;
  partnerAccountId: string | null;
  pinnedAgreementVersion: number;
}

function parseLocalDate(value: string): readonly [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("CONTRACTUAL_DATE_INVALID");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const verified = new Date(Date.UTC(year, month - 1, day));
  if (
    verified.getUTCFullYear() !== year ||
    verified.getUTCMonth() !== month - 1 ||
    verified.getUTCDate() !== day
  )
    throw new Error("CONTRACTUAL_DATE_INVALID");
  return [year, month, day];
}

export function subtractCalendarDays(localDate: string, days: number): string {
  if (!Number.isInteger(days) || days < 0)
    throw new Error("CALENDAR_DAYS_INVALID");
  const [year, month, day] = parseLocalDate(localDate);
  return new Date(Date.UTC(year, month - 1, day - days))
    .toISOString()
    .slice(0, 10);
}

function localParts(
  at: Date,
  timeZone: string,
): Readonly<Record<string, number>> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** Converts a contractual local date/time without relying on the host zone. */
export function localDateTimeToUtc(
  localDate: string,
  timeZone: string,
  hour = 9,
  minute = 0,
): string {
  const [year, month, day] = parseLocalDate(localDate);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = localParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      observed.year ?? 0,
      (observed.month ?? 1) - 1,
      observed.day ?? 1,
      observed.hour ?? 0,
      observed.minute ?? 0,
      observed.second ?? 0,
    );
    candidate += desired - represented;
  }
  const result = localParts(new Date(candidate), timeZone);
  if (
    result.year !== year ||
    result.month !== month ||
    result.day !== day ||
    result.hour !== hour ||
    result.minute !== minute
  )
    throw new Error("LOCAL_TIME_DOES_NOT_EXIST");
  return new Date(candidate).toISOString();
}

function termIdentity(
  term: TermClock,
  operation = "renewal-clock",
): WorkflowIdentity {
  return {
    aggregateType: "order",
    aggregateId: term.orderId,
    aggregateVersion: term.version,
    operation,
  };
}

export function renewalRecipients(input: {
  sourcing: TermClock["sourcing"];
  clientRecipients: readonly string[];
  partnerRecipients: readonly string[];
  internalOwner: string;
}): { commercial: readonly string[]; internal: readonly string[] } {
  return {
    commercial: [
      ...new Set(
        input.sourcing === "resale"
          ? input.partnerRecipients
          : input.clientRecipients,
      ),
    ].sort(),
    internal: [input.internalOwner],
  };
}

export function planTermAlerts(input: {
  term: TermClock;
  now: string;
  alertDaysBeforeNotice: readonly number[];
  alertDaysBeforeEnd: readonly number[];
  clientRecipients: readonly string[];
  partnerRecipients: readonly string[];
  internalOwner: string;
}): readonly RenewalEffect[] {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error("NOW_INVALID");
  const recipients = renewalRecipients({
    sourcing: input.term.sourcing,
    clientRecipients: input.clientRecipients,
    partnerRecipients: input.partnerRecipients,
    internalOwner: input.internalOwner,
  });
  if (recipients.commercial.length === 0)
    throw new Error("RENEWAL_RECIPIENT_REQUIRED");
  const identity = termIdentity(input.term);
  const events = [
    ...input.alertDaysBeforeNotice.map((days) => ({
      window: "notice" as const,
      days,
      localDate: subtractCalendarDays(input.term.noticeOn, days),
    })),
    ...input.alertDaysBeforeEnd.map((days) => ({
      window: "end" as const,
      days,
      localDate: subtractCalendarDays(input.term.endsOn, days),
    })),
  ];
  return events.flatMap((event) => {
    const executeAt = localDateTimeToUtc(event.localDate, input.term.timeZone);
    if (now < Date.parse(executeAt)) return [];
    const discriminator = `${event.window}:${event.days}`;
    return [
      workflowEffect(
        identity,
        `customer-alert:${discriminator}`,
        "send_term_alert",
        {
          orderId: input.term.orderId,
          window: event.window,
          daysRemainingAtAlert: event.days,
          recipients: recipients.commercial,
          partnerOwned: input.term.sourcing === "resale",
        },
      ),
      workflowEffect(
        identity,
        `internal-alert:${discriminator}`,
        "alert_internal_owner",
        {
          orderId: input.term.orderId,
          window: event.window,
          recipients: recipients.internal,
        },
      ),
    ];
  });
}

export interface InboundNoticeRecord {
  noticeId: string;
  type: "non_renewal" | "termination" | "breach_claim" | "other";
  servedOn: string;
  evidenceDocumentId: string;
}

export function evaluateAutoRenewal(input: {
  term: TermClock;
  notices: readonly InboundNoticeRecord[];
  now: string;
  agreementChanged: boolean;
  riskBlocked: boolean;
}): { allowed: boolean; reason: string; agreementVersion: number } {
  if (input.term.renewalType !== "auto_renew")
    return {
      allowed: false,
      reason: "NOT_AUTO_RENEW",
      agreementVersion: input.term.pinnedAgreementVersion,
    };
  const blockingNotice = input.notices.some(
    (notice) =>
      ["non_renewal", "termination"].includes(notice.type) &&
      notice.servedOn <= input.term.noticeOn,
  );
  if (blockingNotice)
    return {
      allowed: false,
      reason: "TIMELY_NOTICE_RECEIVED",
      agreementVersion: input.term.pinnedAgreementVersion,
    };
  if (input.agreementChanged)
    return {
      allowed: false,
      reason: "RE_EXECUTION_REQUIRED",
      agreementVersion: input.term.pinnedAgreementVersion,
    };
  if (input.riskBlocked)
    return {
      allowed: false,
      reason: "RISK_REVIEW_REQUIRED",
      agreementVersion: input.term.pinnedAgreementVersion,
    };
  if (
    Date.parse(input.now) <
    Date.parse(localDateTimeToUtc(input.term.endsOn, input.term.timeZone, 0))
  )
    return {
      allowed: false,
      reason: "TERM_NOT_ENDED",
      agreementVersion: input.term.pinnedAgreementVersion,
    };
  return {
    allowed: true,
    reason: "AUTO_RENEW_ALLOWED",
    agreementVersion: input.term.pinnedAgreementVersion,
  };
}

export function planRenewalRequest(input: {
  term: TermClock;
  sourceQuoteId: string;
  changedTerms: boolean;
  requestedAt: string;
}): readonly RenewalEffect[] {
  const identity = termIdentity(input.term, "renewal-request");
  const effects: RenewalEffect[] = [
    workflowEffect(identity, "prepopulate", "create_renewal_request", {
      orderId: input.term.orderId,
      sourceQuoteId: input.sourceQuoteId,
      agreementVersion: input.term.pinnedAgreementVersion,
      requestedAt: input.requestedAt,
    }),
  ];
  if (input.changedTerms)
    effects.push(
      workflowEffect(identity, "changed-terms-review", "open_legal_exception", {
        orderId: input.term.orderId,
        reason: "CHANGED_RENEWAL_TERMS",
      }),
    );
  return effects;
}

export function planInboundNoticeEvidence(input: {
  term: TermClock;
  notice: InboundNoticeRecord;
}): RenewalEffect {
  parseLocalDate(input.notice.servedOn);
  return workflowEffect(
    termIdentity(input.term, "inbound-notice"),
    `notice:${input.notice.noticeId}`,
    "record_inbound_notice_evidence",
    { ...input.notice, orderId: input.term.orderId, immutable: true },
  );
}
