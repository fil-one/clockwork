import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  hashEvidence,
  hashExactText,
  type ImmutableEvidenceObject,
} from "../agreements";

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const instantWithOffsetPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const quantityPattern = /^(0|[1-9]\d*)(?:\.\d{1,18})?$/;

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function assertLocalDate(value: string, code: string): void {
  invariant(localDatePattern.test(value), code);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  invariant(
    date.getUTCFullYear() === year &&
      date.getUTCMonth() === (month ?? 0) - 1 &&
      date.getUTCDate() === day,
    code,
  );
}

function assertInstant(value: string, code: string): void {
  invariant(instantWithOffsetPattern.test(value), code);
  invariant(!Number.isNaN(Date.parse(value)), code);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function copyEvidence(
  evidence: ImmutableEvidenceObject,
): ImmutableEvidenceObject {
  invariant(
    evidence.documentId.trim().length > 0,
    "NOTICE_EVIDENCE_DOCUMENT_REQUIRED",
  );
  invariant(
    sha256Pattern.test(evidence.sha256),
    "NOTICE_EVIDENCE_HASH_INVALID",
  );
  invariant(
    evidence.storageKey.trim().length > 0,
    "NOTICE_EVIDENCE_STORAGE_KEY_REQUIRED",
  );
  invariant(
    evidence.versionId.trim().length > 0,
    "NOTICE_EVIDENCE_VERSION_REQUIRED",
  );
  invariant(evidence.malwareScan === "clean", "NOTICE_EVIDENCE_NOT_CLEAN");
  assertInstant(evidence.retainedUntil, "NOTICE_EVIDENCE_RETENTION_INVALID");
  assertInstant(evidence.recordedAt, "NOTICE_EVIDENCE_TIME_INVALID");
  return { ...evidence };
}

function dateParts(date: string): readonly [number, number, number] {
  assertLocalDate(date, "CALENDAR_DATE_INVALID");
  const [year, month, day] = date.split("-").map(Number);
  return [year ?? 0, month ?? 0, day ?? 0];
}

export function addCalendarDays(date: string, days: number): string {
  invariant(Number.isInteger(days), "CALENDAR_DAY_DELTA_INVALID");
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function calendarDaysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = dateParts(from);
  const [toYear, toMonth, toDay] = dateParts(to);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86_400_000,
  );
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error("TIME_ZONE_INVALID");
  }
}

function zonedParts(formatter: Intl.DateTimeFormat, instant: Date): ZonedParts {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  };
}

/**
 * Converts a contractual local date/time through an IANA zone. Ambiguous fall
 * times are explicit; nonexistent spring times advance to the first valid wall
 * minute, matching calendar-reminder expectations rather than adding 24 hours.
 */
export function localDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
  ambiguity: "earlier" | "later" = "earlier",
): string {
  const [year, month, day] = dateParts(date);
  invariant(localTimePattern.test(time), "LOCAL_TIME_INVALID");
  const [hour, minute] = time.split(":").map(Number);
  const desiredMinute = (hour ?? 0) * 60 + (minute ?? 0);
  const formatter = formatterFor(timeZone);
  const naive = Date.UTC(year, month - 1, day, hour ?? 0, minute ?? 0);
  const exact: number[] = [];
  let shifted: {
    readonly instant: number;
    readonly wallMinute: number;
  } | null = null;
  for (
    let instant = naive - 18 * 3_600_000;
    instant <= naive + 18 * 3_600_000;
    instant += 60_000
  ) {
    const candidate = zonedParts(formatter, new Date(instant));
    if (
      candidate.year !== year ||
      candidate.month !== month ||
      candidate.day !== day
    )
      continue;
    const wallMinute = candidate.hour * 60 + candidate.minute;
    if (wallMinute === desiredMinute) exact.push(instant);
    if (
      wallMinute > desiredMinute &&
      (!shifted ||
        wallMinute < shifted.wallMinute ||
        (wallMinute === shifted.wallMinute && instant < shifted.instant))
    )
      shifted = { instant, wallMinute };
  }
  if (exact.length > 0) {
    const selected = ambiguity === "earlier" ? exact[0] : exact.at(-1);
    invariant(selected !== undefined, "LOCAL_DATE_TIME_UNRESOLVABLE");
    return new Date(selected).toISOString();
  }
  invariant(shifted, "LOCAL_DATE_TIME_UNRESOLVABLE");
  return new Date(shifted.instant).toISOString();
}

export function localDateAtInstant(instant: string, timeZone: string): string {
  assertInstant(instant, "INSTANT_INVALID");
  const parts = zonedParts(formatterFor(timeZone), new Date(instant));
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export interface PinnedAgreementVersion {
  readonly agreementId: string;
  readonly templateId: string | null;
  readonly templateVersion: string | null;
  readonly textHash: string;
}

export interface RenewableOrderLine {
  readonly lineId: string;
  readonly sku: string;
  readonly quantity: string;
  readonly region: string;
  readonly unitPriceMinor: string;
  readonly currency: "USD" | "EUR" | "GBP";
}

export interface RenewableOrder {
  readonly orderId: string;
  readonly accountId: string;
  readonly endClientAccountId: string | null;
  readonly partnerAccountId: string | null;
  readonly invoicingAccountId: string;
  readonly notificationPath: "direct" | "partner";
  readonly startsOn: string;
  readonly endsOn: string;
  readonly noticeDays: number;
  readonly renewalType: "auto_renew" | "expires";
  readonly timeZone: string;
  readonly pinnedAgreement: PinnedAgreementVersion;
  readonly lines: readonly RenewableOrderLine[];
  readonly commercialOwnerId: string;
  readonly rowVersion: number;
}

function copyOrder(order: RenewableOrder): RenewableOrder {
  assertLocalDate(order.startsOn, "ORDER_START_DATE_INVALID");
  assertLocalDate(order.endsOn, "ORDER_END_DATE_INVALID");
  invariant(order.endsOn > order.startsOn, "ORDER_TERM_INVALID");
  invariant(
    Number.isInteger(order.noticeDays) && order.noticeDays >= 0,
    "ORDER_NOTICE_DAYS_INVALID",
  );
  invariant(
    Number.isInteger(order.rowVersion) && order.rowVersion > 0,
    "ORDER_VERSION_INVALID",
  );
  invariant(
    sha256Pattern.test(order.pinnedAgreement.textHash),
    "PINNED_AGREEMENT_HASH_INVALID",
  );
  formatterFor(order.timeZone);
  for (const line of order.lines) {
    invariant(
      quantityPattern.test(line.quantity),
      "ORDER_LINE_QUANTITY_INVALID",
    );
    invariant(
      /^-?(0|[1-9]\d*)$/.test(line.unitPriceMinor),
      "ORDER_LINE_PRICE_INVALID",
    );
  }
  invariant(
    new Set(order.lines.map((line) => line.lineId)).size === order.lines.length,
    "ORDER_LINE_ID_DUPLICATE",
  );
  if (order.notificationPath === "partner") {
    invariant(
      order.partnerAccountId !== null,
      "PARTNER_NOTIFICATION_SCOPE_MISSING",
    );
    invariant(
      order.invoicingAccountId === order.partnerAccountId,
      "PARTNER_INVOICING_SCOPE_MISMATCH",
    );
  } else {
    invariant(
      order.invoicingAccountId === order.accountId,
      "DIRECT_INVOICING_SCOPE_MISMATCH",
    );
  }
  return {
    ...order,
    pinnedAgreement: { ...order.pinnedAgreement },
    lines: order.lines.map((line) => ({ ...line })),
  };
}

export interface AmendmentLine {
  readonly amendmentLineId: string;
  readonly kind: "add" | "increase" | "decrease" | "remove";
  readonly supersededLineId: string | null;
  readonly resultingLine: RenewableOrderLine | null;
}

export interface Amendment {
  readonly amendmentId: string;
  readonly parentOrderId: string;
  readonly parentOrderVersion: number;
  readonly effectiveOn: string;
  readonly kind:
    "upgrade" | "downgrade" | "term_extension" | "co_termination" | "mixed";
  readonly lines: readonly AmendmentLine[];
  readonly prorationMethod: "daily" | "monthly" | "none" | "custom";
  readonly prorationExplanation: string | null;
  readonly resultingEndsOn: string;
  readonly acceptanceEvidenceHash: string;
  readonly executedDocument: ImmutableEvidenceObject;
  readonly createdAt: string;
}

export function createAmendment(input: Amendment): Amendment {
  invariant(input.amendmentId.trim().length > 0, "AMENDMENT_ID_REQUIRED");
  invariant(input.parentOrderId.trim().length > 0, "AMENDMENT_PARENT_REQUIRED");
  invariant(
    Number.isInteger(input.parentOrderVersion) && input.parentOrderVersion > 0,
    "AMENDMENT_PARENT_VERSION_INVALID",
  );
  assertLocalDate(input.effectiveOn, "AMENDMENT_EFFECTIVE_DATE_INVALID");
  assertLocalDate(input.resultingEndsOn, "AMENDMENT_END_DATE_INVALID");
  assertInstant(input.createdAt, "AMENDMENT_CREATED_AT_INVALID");
  invariant(
    sha256Pattern.test(input.acceptanceEvidenceHash),
    "AMENDMENT_ACCEPTANCE_HASH_INVALID",
  );
  invariant(
    input.lines.length > 0 ||
      input.kind === "term_extension" ||
      input.kind === "co_termination",
    "AMENDMENT_CHANGE_REQUIRED",
  );
  invariant(
    input.prorationMethod !== "custom" ||
      Boolean(input.prorationExplanation?.trim()),
    "AMENDMENT_PRORATION_EXPLANATION_REQUIRED",
  );
  const superseded = input.lines.flatMap((line) =>
    line.supersededLineId ? [line.supersededLineId] : [],
  );
  invariant(
    new Set(superseded).size === superseded.length,
    "AMENDMENT_LINE_SUPERSEDED_TWICE",
  );
  invariant(
    new Set(input.lines.map((line) => line.amendmentLineId)).size ===
      input.lines.length,
    "AMENDMENT_LINE_ID_DUPLICATE",
  );
  for (const line of input.lines) {
    invariant(
      line.amendmentLineId.trim().length > 0,
      "AMENDMENT_LINE_ID_REQUIRED",
    );
    if (line.kind === "add") {
      invariant(
        line.supersededLineId === null && line.resultingLine !== null,
        "AMENDMENT_ADD_INVALID",
      );
    } else {
      invariant(
        line.supersededLineId !== null,
        "AMENDMENT_SUPERSEDED_LINE_REQUIRED",
      );
    }
    if (line.kind === "remove")
      invariant(line.resultingLine === null, "AMENDMENT_REMOVE_INVALID");
    if (line.resultingLine)
      invariant(
        quantityPattern.test(line.resultingLine.quantity),
        "AMENDMENT_QUANTITY_INVALID",
      );
    if (line.resultingLine && line.supersededLineId)
      invariant(
        line.resultingLine.lineId !== line.supersededLineId,
        "AMENDMENT_RESULT_LINE_MUST_BE_NEW_VERSION",
      );
  }
  return deepFreeze({
    ...input,
    lines: input.lines.map((line) => ({
      ...line,
      resultingLine: line.resultingLine ? { ...line.resultingLine } : null,
    })),
    executedDocument: copyEvidence(input.executedDocument),
  });
}

/** Replaces parent lines in place, preserving one order and one term clock. */
export function applyAmendment(
  order: RenewableOrder,
  amendment: Amendment,
): RenewableOrder {
  const current = copyOrder(order);
  invariant(
    amendment.parentOrderId === current.orderId,
    "AMENDMENT_ORDER_MISMATCH",
  );
  invariant(
    amendment.parentOrderVersion === current.rowVersion,
    "AMENDMENT_VERSION_CONFLICT",
  );
  invariant(amendment.effectiveOn >= current.startsOn, "AMENDMENT_BEFORE_TERM");
  invariant(amendment.effectiveOn <= current.endsOn, "AMENDMENT_AFTER_TERM");
  const lines = new Map(current.lines.map((line) => [line.lineId, line]));
  for (const delta of amendment.lines) {
    if (delta.supersededLineId) {
      invariant(
        lines.has(delta.supersededLineId),
        "AMENDMENT_SUPERSEDED_LINE_NOT_FOUND",
      );
      lines.delete(delta.supersededLineId);
    }
    if (delta.resultingLine) {
      invariant(
        !lines.has(delta.resultingLine.lineId),
        "AMENDMENT_RESULT_LINE_DUPLICATE",
      );
      lines.set(delta.resultingLine.lineId, { ...delta.resultingLine });
    }
  }
  invariant(
    amendment.resultingEndsOn >= amendment.effectiveOn,
    "AMENDMENT_RESULT_TERM_INVALID",
  );
  return deepFreeze({
    ...current,
    endsOn: amendment.resultingEndsOn,
    lines: [...lines.values()],
    rowVersion: current.rowVersion + 1,
  });
}

export interface AgreementReexecutionEvidence {
  readonly priorAgreementId: string;
  readonly newAgreement: PinnedAgreementVersion;
  readonly executionEvidenceHash: string;
  readonly executedAt: string;
  readonly reason:
    | "template_upgrade"
    | "changed_terms"
    | "agreement_type_change"
    | "discount_tier_change";
}

export function resolveRenewalAgreement(input: {
  readonly pinned: PinnedAgreementVersion;
  readonly requested: PinnedAgreementVersion;
  readonly autoRenewal: boolean;
  readonly reexecution: AgreementReexecutionEvidence | null;
}): PinnedAgreementVersion {
  const unchanged =
    input.pinned.agreementId === input.requested.agreementId &&
    input.pinned.templateId === input.requested.templateId &&
    input.pinned.templateVersion === input.requested.templateVersion &&
    input.pinned.textHash === input.requested.textHash;
  if (unchanged) return deepFreeze({ ...input.pinned });
  invariant(!input.autoRenewal, "AUTO_RENEWAL_MUST_KEEP_PINNED_AGREEMENT");
  invariant(input.reexecution, "AGREEMENT_REEXECUTION_REQUIRED");
  invariant(
    input.reexecution.priorAgreementId === input.pinned.agreementId,
    "REEXECUTION_PRIOR_AGREEMENT_MISMATCH",
  );
  invariant(
    input.reexecution.newAgreement.agreementId ===
      input.requested.agreementId &&
      input.reexecution.newAgreement.textHash === input.requested.textHash,
    "REEXECUTION_NEW_AGREEMENT_MISMATCH",
  );
  invariant(
    sha256Pattern.test(input.reexecution.executionEvidenceHash),
    "REEXECUTION_EVIDENCE_HASH_INVALID",
  );
  assertInstant(input.reexecution.executedAt, "REEXECUTION_TIME_INVALID");
  return deepFreeze({ ...input.requested });
}

export interface RenewalRequest {
  readonly requestId: string;
  readonly sourceOrderId: string;
  readonly sourceOrderVersion: number;
  readonly accountId: string;
  readonly proposedStartsOn: string;
  readonly proposedEndsOn: string;
  readonly lines: readonly RenewableOrderLine[];
  readonly agreement: PinnedAgreementVersion;
  readonly agreementUpgradeStatus:
    "pinned" | "reexecution_required" | "reexecuted";
  readonly requestedAction: "renew" | "change_term" | "request_change";
  readonly createdAt: string;
}

export function prepopulateRenewalRequest(input: {
  readonly requestId: string;
  readonly order: RenewableOrder;
  readonly proposedEndsOn: string;
  readonly requestedAction?: RenewalRequest["requestedAction"];
  readonly requestedAgreement?: PinnedAgreementVersion;
  readonly reexecution?: AgreementReexecutionEvidence | null;
  readonly createdAt: string;
}): RenewalRequest {
  const order = copyOrder(input.order);
  assertLocalDate(input.proposedEndsOn, "RENEWAL_END_DATE_INVALID");
  invariant(input.proposedEndsOn > order.endsOn, "RENEWAL_TERM_NOT_EXTENDED");
  assertInstant(input.createdAt, "RENEWAL_REQUEST_TIME_INVALID");
  const requestedAgreement = input.requestedAgreement ?? order.pinnedAgreement;
  const sameAgreement =
    requestedAgreement.agreementId === order.pinnedAgreement.agreementId;
  const agreement = sameAgreement
    ? resolveRenewalAgreement({
        pinned: order.pinnedAgreement,
        requested: requestedAgreement,
        autoRenewal: false,
        reexecution: null,
      })
    : input.reexecution
      ? resolveRenewalAgreement({
          pinned: order.pinnedAgreement,
          requested: requestedAgreement,
          autoRenewal: false,
          reexecution: input.reexecution,
        })
      : { ...requestedAgreement };
  return deepFreeze({
    requestId: input.requestId,
    sourceOrderId: order.orderId,
    sourceOrderVersion: order.rowVersion,
    accountId: order.accountId,
    proposedStartsOn: addCalendarDays(order.endsOn, 1),
    proposedEndsOn: input.proposedEndsOn,
    lines: order.lines.map((line) => ({ ...line })),
    agreement,
    agreementUpgradeStatus: sameAgreement
      ? "pinned"
      : input.reexecution
        ? "reexecuted"
        : "reexecution_required",
    requestedAction: input.requestedAction ?? "renew",
    createdAt: input.createdAt,
  });
}

/** Prevents a pre-populated version-upgrade request from executing early. */
export function assertRenewalRequestReady(
  request: RenewalRequest,
): RenewalRequest {
  invariant(
    request.agreementUpgradeStatus !== "reexecution_required",
    "AGREEMENT_REEXECUTION_REQUIRED",
  );
  invariant(
    sha256Pattern.test(request.agreement.textHash),
    "RENEWAL_AGREEMENT_HASH_INVALID",
  );
  return request;
}

export interface InboundNotice {
  readonly noticeId: string;
  readonly accountId: string;
  readonly orderId: string;
  readonly type: "non_renewal" | "termination" | "breach_claim";
  readonly servedOn: string;
  readonly receivedAt: string;
  readonly recordedByUserId: string;
  readonly deliveryChannel: "portal" | "email" | "post" | "courier" | "other";
  readonly evidence: ImmutableEvidenceObject;
  readonly immutableHash: string;
}

export function recordInboundNotice(
  input: Omit<InboundNotice, "immutableHash">,
): InboundNotice {
  invariant(input.noticeId.trim().length > 0, "INBOUND_NOTICE_ID_REQUIRED");
  invariant(
    input.recordedByUserId.trim().length > 0,
    "INBOUND_NOTICE_RECORDER_REQUIRED",
  );
  assertLocalDate(input.servedOn, "NOTICE_SERVED_ON_INVALID");
  assertInstant(input.receivedAt, "NOTICE_RECEIVED_AT_INVALID");
  const notice = { ...input, evidence: copyEvidence(input.evidence) };
  return deepFreeze({ ...notice, immutableHash: hashEvidence(notice) });
}

export interface RenewalDeclineEvidence {
  readonly declineId: string;
  readonly orderId: string;
  readonly accountId: string;
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly authorityTitle: string;
  readonly authorityAttestation: string;
  readonly declinedAt: string;
  readonly servedOn: string;
  readonly ipAddress: string;
  readonly uiContext: {
    readonly route: string;
    readonly action: "decline_renewal";
    readonly sessionId: string;
    readonly requestId: string;
    readonly userAgent: string;
  };
  readonly exactDeclineTextHash: string;
  readonly timeliness: "timely" | "late";
  readonly evidenceHash: string;
}

export function recordRenewalDecline(input: {
  readonly declineId: string;
  readonly order: RenewableOrder;
  readonly legalEntityName: string;
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly authorityTitle: string;
  readonly authorityAttested: boolean;
  readonly declinedAt: string;
  readonly ipAddress: string;
  readonly uiContext: RenewalDeclineEvidence["uiContext"];
  readonly exactDeclineText: string;
}): RenewalDeclineEvidence {
  const order = copyOrder(input.order);
  assertInstant(input.declinedAt, "DECLINE_TIME_INVALID");
  invariant(input.authorityAttested, "DECLINE_AUTHORITY_ATTESTATION_REQUIRED");
  invariant(
    input.authorityTitle.trim().length > 0,
    "DECLINE_AUTHORITY_TITLE_REQUIRED",
  );
  invariant(
    input.userId.trim().length > 0 && input.email.includes("@"),
    "DECLINE_IDENTITY_INVALID",
  );
  invariant(input.role.trim().length > 0, "DECLINE_ROLE_REQUIRED");
  invariant(isIP(input.ipAddress) !== 0, "DECLINE_IP_INVALID");
  invariant(input.uiContext.route.startsWith("/"), "DECLINE_UI_ROUTE_INVALID");
  invariant(
    input.uiContext.action === "decline_renewal",
    "DECLINE_UI_ACTION_INVALID",
  );
  for (const value of [
    input.uiContext.sessionId,
    input.uiContext.requestId,
    input.uiContext.userAgent,
  ])
    invariant(value.trim().length > 0, "DECLINE_UI_CONTEXT_INCOMPLETE");
  invariant(input.exactDeclineText.trim().length > 0, "DECLINE_TEXT_REQUIRED");
  const servedOn = localDateAtInstant(input.declinedAt, order.timeZone);
  const noticeDeadline = addCalendarDays(order.endsOn, -order.noticeDays);
  const body = {
    declineId: input.declineId,
    orderId: order.orderId,
    accountId: order.accountId,
    userId: input.userId,
    email: input.email.toLowerCase(),
    role: input.role,
    authorityTitle: input.authorityTitle.trim(),
    authorityAttestation: `I am authorized to bind ${input.legalEntityName.trim()}`,
    declinedAt: input.declinedAt,
    servedOn,
    ipAddress: input.ipAddress,
    uiContext: { ...input.uiContext },
    exactDeclineTextHash: hashExactText(input.exactDeclineText),
    timeliness:
      servedOn <= noticeDeadline ? ("timely" as const) : ("late" as const),
  };
  return deepFreeze({ ...body, evidenceHash: hashEvidence(body) });
}

export interface AutoRenewalDecision {
  readonly outcome: "renew" | "blocked" | "legal_review" | "disabled";
  readonly reasons: readonly string[];
  readonly noticeDeadline: string;
}

export function evaluateAutoRenewal(input: {
  readonly order: RenewableOrder;
  readonly notices: readonly InboundNotice[];
  readonly declines: readonly RenewalDeclineEvidence[];
  readonly screeningStatus: "clear" | "review" | "blocked";
  readonly overdueInvoice: boolean;
  readonly materialRiskHold: boolean;
}): AutoRenewalDecision {
  const order = copyOrder(input.order);
  const noticeDeadline = addCalendarDays(order.endsOn, -order.noticeDays);
  if (order.renewalType === "expires")
    return deepFreeze({
      outcome: "disabled" as const,
      reasons: ["ORDER_EXPIRES"],
      noticeDeadline,
    });
  const reasons: string[] = [];
  let legalReview = false;
  for (const notice of input.notices.filter(
    (item) => item.orderId === order.orderId,
  )) {
    invariant(
      notice.accountId === order.accountId,
      "INBOUND_NOTICE_ACCOUNT_SCOPE_MISMATCH",
    );
    invariant(
      hashEvidence({
        noticeId: notice.noticeId,
        accountId: notice.accountId,
        orderId: notice.orderId,
        type: notice.type,
        servedOn: notice.servedOn,
        receivedAt: notice.receivedAt,
        recordedByUserId: notice.recordedByUserId,
        deliveryChannel: notice.deliveryChannel,
        evidence: notice.evidence,
      }) === notice.immutableHash,
      "INBOUND_NOTICE_HASH_MISMATCH",
    );
    if (notice.type === "non_renewal" || notice.type === "termination") {
      if (notice.servedOn <= noticeDeadline)
        reasons.push("TIMELY_INBOUND_NOTICE");
      else {
        reasons.push("LATE_INBOUND_NOTICE");
        legalReview = true;
      }
    }
  }
  for (const decline of input.declines.filter(
    (item) => item.orderId === order.orderId,
  )) {
    invariant(
      decline.accountId === order.accountId,
      "DECLINE_ACCOUNT_SCOPE_MISMATCH",
    );
    const { evidenceHash, ...declineBody } = decline;
    invariant(
      hashEvidence(declineBody) === evidenceHash,
      "DECLINE_EVIDENCE_HASH_MISMATCH",
    );
    if (decline.timeliness === "timely") reasons.push("TIMELY_PORTAL_DECLINE");
    else {
      reasons.push("LATE_PORTAL_DECLINE");
      legalReview = true;
    }
  }
  if (input.screeningStatus === "blocked") reasons.push("SCREENING_BLOCKED");
  if (input.screeningStatus === "review") {
    reasons.push("SCREENING_REVIEW");
    legalReview = true;
  }
  if (input.overdueInvoice) reasons.push("OVERDUE_INVOICE");
  if (input.materialRiskHold) reasons.push("MATERIAL_RISK_HOLD");
  const hardBlock = reasons.some((reason) =>
    [
      "TIMELY_INBOUND_NOTICE",
      "TIMELY_PORTAL_DECLINE",
      "SCREENING_BLOCKED",
      "OVERDUE_INVOICE",
      "MATERIAL_RISK_HOLD",
    ].includes(reason),
  );
  return deepFreeze({
    outcome: hardBlock ? "blocked" : legalReview ? "legal_review" : "renew",
    reasons,
    noticeDeadline,
  });
}

export interface TermAlert {
  readonly alertId: string;
  readonly orderId: string;
  readonly kind: "before_notice_window" | "before_end" | "notice_window_open";
  readonly localDate: string;
  readonly scheduledFor: string;
  readonly timeZone: string;
  readonly idempotencyKey: string;
}

export function scheduleTermAlerts(input: {
  readonly order: RenewableOrder;
  readonly beforeNoticeDays: readonly number[];
  readonly beforeEndDays: readonly number[];
  readonly localSendTime: string;
  readonly notBeforeInstant: string;
}): readonly TermAlert[] {
  const order = copyOrder(input.order);
  assertInstant(input.notBeforeInstant, "ALERT_NOT_BEFORE_INVALID");
  invariant(
    localTimePattern.test(input.localSendTime),
    "ALERT_LOCAL_TIME_INVALID",
  );
  const noticeOpensOn = addCalendarDays(order.endsOn, -order.noticeDays);
  const candidates: { kind: TermAlert["kind"]; localDate: string }[] = [
    ...input.beforeNoticeDays.map((days) => {
      invariant(Number.isInteger(days) && days >= 0, "ALERT_INTERVAL_INVALID");
      return {
        kind:
          days === 0
            ? ("notice_window_open" as const)
            : ("before_notice_window" as const),
        localDate: addCalendarDays(noticeOpensOn, -days),
      };
    }),
    ...input.beforeEndDays.map((days) => {
      invariant(Number.isInteger(days) && days >= 0, "ALERT_INTERVAL_INVALID");
      return {
        kind: "before_end" as const,
        localDate: addCalendarDays(order.endsOn, -days),
      };
    }),
  ];
  const deduped = new Map<string, TermAlert>();
  for (const candidate of candidates) {
    const scheduledFor = localDateTimeToInstant(
      candidate.localDate,
      input.localSendTime,
      order.timeZone,
    );
    if (Date.parse(scheduledFor) < Date.parse(input.notBeforeInstant)) continue;
    const alertId = `${order.orderId}:${candidate.kind}:${candidate.localDate}`;
    const key = `${candidate.kind}:${candidate.localDate}`;
    deduped.set(
      key,
      deepFreeze({
        alertId,
        orderId: order.orderId,
        kind: candidate.kind,
        localDate: candidate.localDate,
        scheduledFor,
        timeZone: order.timeZone,
        idempotencyKey: `renewal-alert:${alertId}`,
      }),
    );
  }
  return deepFreeze(
    [...deduped.values()].sort(
      (left, right) =>
        Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor),
    ),
  );
}

export interface RenewalNotification {
  readonly commercialRecipients: readonly string[];
  readonly internalRecipients: readonly string[];
  readonly endClientRecipients: readonly [];
  readonly payload: {
    readonly orderReference: string;
    readonly endClientDisplayName: string | null;
    readonly endsOn: string;
    readonly noticeDeadline: string;
    readonly actionUrl: string;
  };
}

/**
 * The allow-listed payload intentionally cannot carry margin, transfer price,
 * Fil One agreement details, or other partner-confidential commercials.
 */
export function routeRenewalNotification(input: {
  readonly order: RenewableOrder;
  readonly directContacts: readonly string[];
  readonly partnerContacts: readonly string[];
  readonly endClientContacts: readonly string[];
  readonly internalOwnerEmail: string;
  readonly endClientDisplayName: string | null;
  readonly actionUrl: string;
}): RenewalNotification {
  const order = copyOrder(input.order);
  const partnerPath = order.notificationPath === "partner";
  invariant(
    !partnerPath || order.partnerAccountId !== null,
    "PARTNER_NOTIFICATION_SCOPE_MISSING",
  );
  invariant(
    input.actionUrl.startsWith("https://"),
    "RENEWAL_ACTION_URL_INVALID",
  );
  const recipients = partnerPath ? input.partnerContacts : input.directContacts;
  invariant(recipients.length > 0, "RENEWAL_RECIPIENT_REQUIRED");
  return deepFreeze({
    commercialRecipients: [
      ...new Set(recipients.map((email) => email.toLowerCase())),
    ],
    internalRecipients: [input.internalOwnerEmail.toLowerCase()],
    endClientRecipients: [] as const,
    payload: {
      orderReference: order.orderId,
      endClientDisplayName: partnerPath ? input.endClientDisplayName : null,
      endsOn: order.endsOn,
      noticeDeadline: addCalendarDays(order.endsOn, -order.noticeDays),
      actionUrl: input.actionUrl,
    },
  });
}

export interface RenewalRiskSignals {
  readonly openSupportIssueCount: number;
  readonly highestSupportSeverity:
    "none" | "low" | "medium" | "high" | "critical";
  readonly usageChangeBasisPoints: number;
  readonly overdueInvoiceDays: number;
  readonly portalInactivityDays: number;
  readonly partnerHasActed: boolean | null;
  readonly unresolvedNotice: boolean;
}

export interface RenewalCommandCenterRow {
  readonly orderId: string;
  readonly accountId: string;
  readonly segment: "direct" | "partner_sourced" | "partner_agreement";
  readonly bucket: "past_due" | "0_30" | "31_90" | "91_180" | "later";
  readonly daysToExpiry: number;
  readonly riskScore: number;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  readonly riskReasons: readonly string[];
  readonly ownerId: string;
  readonly lastTouchAt: string | null;
  readonly status:
    | "uncontacted"
    | "contacted"
    | "negotiating"
    | "committed"
    | "declined"
    | "at_risk";
}

function scoreRisk(signals: RenewalRiskSignals): {
  score: number;
  reasons: readonly string[];
} {
  for (const value of [
    signals.openSupportIssueCount,
    signals.overdueInvoiceDays,
    signals.portalInactivityDays,
  ])
    invariant(Number.isInteger(value) && value >= 0, "RISK_SIGNAL_INVALID");
  invariant(
    Number.isInteger(signals.usageChangeBasisPoints),
    "RISK_SIGNAL_INVALID",
  );
  let score = 0;
  const reasons: string[] = [];
  const severityWeight = {
    none: 0,
    low: 5,
    medium: 12,
    high: 24,
    critical: 40,
  }[signals.highestSupportSeverity];
  if (severityWeight > 0) {
    score += severityWeight;
    reasons.push(`SUPPORT_${signals.highestSupportSeverity.toUpperCase()}`);
  }
  if (signals.openSupportIssueCount > 1) {
    score += Math.min(15, signals.openSupportIssueCount * 3);
    reasons.push("MULTIPLE_SUPPORT_ISSUES");
  }
  if (signals.usageChangeBasisPoints <= -2_000) {
    score += Math.min(
      25,
      Math.floor(Math.abs(signals.usageChangeBasisPoints) / 500),
    );
    reasons.push("DECLINING_USAGE");
  }
  if (signals.overdueInvoiceDays > 0) {
    score += Math.min(25, 5 + Math.floor(signals.overdueInvoiceDays / 7) * 5);
    reasons.push("OVERDUE_INVOICE");
  }
  if (signals.portalInactivityDays >= 30) {
    score += Math.min(15, Math.floor(signals.portalInactivityDays / 30) * 5);
    reasons.push("PORTAL_INACTIVITY");
  }
  if (signals.partnerHasActed === false) {
    score += 15;
    reasons.push("PARTNER_NOT_ACTED");
  }
  if (signals.unresolvedNotice) {
    score += 35;
    reasons.push("UNRESOLVED_NOTICE");
  }
  return { score: Math.min(100, score), reasons };
}

export function buildRenewalCommandCenter(input: {
  readonly asOfDate: string;
  readonly items: readonly {
    readonly order: RenewableOrder;
    readonly segment: RenewalCommandCenterRow["segment"];
    readonly signals: RenewalRiskSignals;
    readonly lastTouchAt: string | null;
    readonly status: RenewalCommandCenterRow["status"];
  }[];
}): readonly RenewalCommandCenterRow[] {
  assertLocalDate(input.asOfDate, "COMMAND_CENTER_AS_OF_INVALID");
  const rows = input.items.map((item) => {
    const order = copyOrder(item.order);
    const daysToExpiry = calendarDaysBetween(input.asOfDate, order.endsOn);
    const risk = scoreRisk(item.signals);
    if (item.lastTouchAt)
      assertInstant(item.lastTouchAt, "LAST_TOUCH_TIME_INVALID");
    const bucket: RenewalCommandCenterRow["bucket"] =
      daysToExpiry < 0
        ? "past_due"
        : daysToExpiry <= 30
          ? "0_30"
          : daysToExpiry <= 90
            ? "31_90"
            : daysToExpiry <= 180
              ? "91_180"
              : "later";
    const riskLevel: RenewalCommandCenterRow["riskLevel"] =
      risk.score >= 75
        ? "critical"
        : risk.score >= 50
          ? "high"
          : risk.score >= 25
            ? "medium"
            : "low";
    return deepFreeze({
      orderId: order.orderId,
      accountId: order.accountId,
      segment: item.segment,
      bucket,
      daysToExpiry,
      riskScore: risk.score,
      riskLevel,
      riskReasons: risk.reasons,
      ownerId: order.commercialOwnerId,
      lastTouchAt: item.lastTouchAt,
      status: item.status,
    });
  });
  return deepFreeze(
    rows.sort(
      (left, right) =>
        left.daysToExpiry - right.daysToExpiry ||
        right.riskScore - left.riskScore ||
        left.orderId.localeCompare(right.orderId),
    ),
  );
}

export function renewalOperationIdempotencyKey(input: {
  readonly aggregateType: "order" | "agreement";
  readonly aggregateId: string;
  readonly version: number;
  readonly operation: string;
}): string {
  invariant(
    Number.isInteger(input.version) && input.version > 0,
    "OPERATION_VERSION_INVALID",
  );
  invariant(
    /^[a-z][a-z0-9_]+$/.test(input.operation),
    "OPERATION_NAME_INVALID",
  );
  return `renewals:${input.aggregateType}:${input.aggregateId}:v${input.version}:${input.operation}:${createHash(
    "sha256",
  )
    .update(
      `${input.aggregateType}\0${input.aggregateId}\0${input.version}\0${input.operation}`,
    )
    .digest("hex")
    .slice(0, 24)}`;
}
