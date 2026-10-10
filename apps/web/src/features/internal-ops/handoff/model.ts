import {
  handoffErrorCodes,
  handoffStatuses,
  type HandoffRequestedSide,
  type HandoffStatus,
} from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

export const handoffStatusLabels: Readonly<Record<HandoffStatus, MessageId>> = {
  open: "operations.handoff.status.open",
  in_progress: "operations.handoff.status.in_progress",
  done: "operations.handoff.status.done",
  declined: "operations.handoff.status.declined",
};

export const handoffStatusTone: Readonly<
  Record<HandoffStatus, "neutral" | "info" | "success" | "warning" | "danger">
> = {
  open: "warning",
  in_progress: "info",
  done: "success",
  declined: "neutral",
};

export const handoffSideLabels: Readonly<
  Record<HandoffRequestedSide, MessageId>
> = {
  customer: "operations.handoff.side.customer",
  partner: "operations.handoff.side.partner",
};

const otherErrors = [
  "INVALID_INPUT",
  "CONTRACT_FORBIDDEN",
  "CONTRACT_MFA_REQUIRED",
  "CONTRACT_DEMO_UNAVAILABLE",
  "SESSION_EXPIRED",
  "UNEXPECTED",
] as const;
type HandoffMessageCode =
  (typeof handoffErrorCodes)[number] | (typeof otherErrors)[number];

const errorMessages = Object.fromEntries(
  [...handoffErrorCodes, ...otherErrors].map((code) => [
    code,
    `operations.handoff.error.${code}`,
  ]),
) as Record<HandoffMessageCode, MessageId>;

/** The message for an action's refusal; unknown codes read as unexpected. */
export function handoffErrorMessage(code: string): MessageId {
  return errorMessages[code as HandoffMessageCode] ?? errorMessages.UNEXPECTED;
}

/** A status filter from the query string, or none for every status. */
export function handoffStatusFilter(
  value: string | string[] | undefined,
): HandoffStatus | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return (handoffStatuses as readonly string[]).includes(first ?? "")
    ? (first as HandoffStatus)
    : undefined;
}

/** The calendar day of an ISO instant, in UTC, for a short date. */
export const handoffDay = (iso: string) => iso.slice(0, 10);
