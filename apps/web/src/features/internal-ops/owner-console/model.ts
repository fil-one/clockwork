import type { MessageId } from "@/src/i18n";

import { demoTeamMembers, type TeamMemberView } from "../team/model";

/**
 * The owner console at /internal/owner: one page where a commerce
 * administrator sees what needs them (notices, requests waiting for a second
 * person) and what is true right now (switches, staff, assisted sessions,
 * recent security events).
 *
 * Every section loads on its own. One that fails says so and the rest of the
 * page still renders.
 */
export type ConsoleSection<T> =
  { state: "ready"; items: readonly T[] } | { state: "unavailable" };

/** One recorded event, already reduced to what the page words. */
export interface ConsoleEventView {
  id: string;
  /** The audit event type, which picks the sentence. */
  type: string;
  at: string;
  /** Who acted; null when the system did. */
  actor: { name: string; email: string } | null;
  /** The person, account or address the event is about. */
  subject: string | null;
  /** The role granted, removed or given, for staff events. */
  role: string | null;
  /** The reason written with the change, when there is one. */
  reason: string | null;
  /** The control a self-approval was given on. */
  control?: ApprovalControl | null;
}

export interface NoticeView extends ConsoleEventView {
  noticeId: string;
}

export interface CapabilityView {
  key: string;
  enabled: boolean;
  recoveryEnabled: boolean;
  /** An activation request is waiting for a second person. */
  pending: boolean;
}

export interface AssistedSessionSummary {
  id: string;
  staffName: string;
  staffEmail: string;
  accountName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
}

export const approvalControls = [
  "price_book_activation",
  "tax_rule_book_activation",
  "capability_activation",
  "channel_policy",
  "payg_offer",
  "exception_case",
  "termination",
] as const;
export type ApprovalControl = (typeof approvalControls)[number];

/**
 * What "Approve my own request" sends for a request on the console: the
 * record the control's own approval acts on and its current version. A price
 * book is activated when it is already in effect and scheduled when it takes
 * effect later.
 */
export interface ConsoleSelfApprovalTarget {
  id: string;
  version: number | null;
  priceBookAction?: "activate" | "schedule_activation";
}

/**
 * One request waiting for a second person, from any control. Each is decided
 * on its own page by someone other than the person who raised it, or, for a
 * commerce administrator's own request, approved here with a reason.
 */
export interface ApprovalItemView {
  id: string;
  control: ApprovalControl;
  /** What it is about: a price book, jurisdiction, capability, SKU or account. */
  name: string | null;
  version: number | null;
  /** A region for an offer, a queue for an exception, a date for a policy. */
  detail: string | null;
  requestedBy: string | null;
  requestedAt: string;
  /** Where the request is read and decided; null when it has no page. */
  href: string | null;
  /** The reader raised it, so someone else must decide it. */
  ownRequest: boolean;
  /**
   * The reader may approve it themselves here: their own request, they hold
   * `approval:self`, and the control is decided in the portal. Null
   * otherwise.
   */
  selfApproval: ConsoleSelfApprovalTarget | null;
}

/** One request a commerce administrator approved themselves. */
export interface SelfApprovalView {
  id: string;
  at: string;
  actor: { name: string; email: string } | null;
  control: ApprovalControl | null;
  name: string | null;
  version: number | null;
  detail: string | null;
  reason: string;
}

/**
 * The open requests of every control that could be read, and the controls
 * that could not. Each control is read on its own, so one that fails leaves
 * the rest of the list in place.
 */
export interface ApprovalsView {
  items: readonly ApprovalItemView[];
  unavailable: readonly ApprovalControl[];
}

export interface OwnerConsoleView {
  /** `live` reads the database; `demo` shows sample records and changes nothing. */
  mode: "live" | "demo";
  viewerUserId: string;
  notices: ConsoleSection<NoticeView>;
  approvals: ApprovalsView;
  capabilities: ConsoleSection<CapabilityView>;
  staff: ConsoleSection<TeamMemberView>;
  assistedSessions: ConsoleSection<AssistedSessionSummary>;
  securityEvents: ConsoleSection<ConsoleEventView>;
  /** Requests approved by the person who raised them, newest first. */
  selfApprovals: ConsoleSection<SelfApprovalView>;
}

/** The sentence for each kind of event the console lists. */
export const eventMessages: Readonly<Record<string, MessageId>> = {
  "staff.invited": "operations.owner.event.staffInvited",
  "staff.reactivated": "operations.owner.event.staffReactivated",
  "staff.deactivated": "operations.owner.event.staffDeactivated",
  "staff.role_changed": "operations.owner.event.staffRoleChanged",
  "staff.role_granted": "operations.owner.event.staffRoleGranted",
  "staff.role_revoked": "operations.owner.event.staffRoleRevoked",
  "identity.mfa_enrolled": "operations.owner.event.mfaEnrolled",
  "mnda.signer_configured": "operations.owner.event.mndaSigner",
  "mnda.settings_changed": "operations.owner.event.mndaNoticeEmail",
  "mnda.register_exported": "operations.owner.event.mndaExported",
  "contract.register_exported": "operations.owner.event.contractsExported",
  "workflow.report_exported": "operations.owner.event.reportExported",
  "security.assisted_action.started": "operations.owner.event.assistedStarted",
  "approval.self_approved": "operations.owner.event.selfApproved",
};

export const capabilityLabels: Readonly<Record<string, MessageId>> = {
  new_business: "operations.owner.capability.newBusiness",
  legal: "operations.owner.capability.legal",
  billing: "operations.owner.capability.billing",
  partner: "operations.owner.capability.partner",
  marketplace: "operations.owner.capability.marketplace",
  teardown: "operations.owner.capability.teardown",
};

/** What kind of request each control raises. */
export const approvalControlLabels: Readonly<
  Record<ApprovalControl, MessageId>
> = {
  price_book_activation: "operations.owner.approvals.control.priceBook",
  tax_rule_book_activation: "operations.owner.approvals.control.taxRuleBook",
  capability_activation: "operations.owner.approvals.control.capability",
  channel_policy: "operations.owner.approvals.control.channelPolicy",
  payg_offer: "operations.owner.approvals.control.paygOffer",
  exception_case: "operations.owner.approvals.control.exception",
  termination: "operations.owner.approvals.control.termination",
};

export const noticeErrorCodes = [
  "NOT_PERMITTED",
  "DIRECT_SESSION_REQUIRED",
  "INVALID_INPUT",
  "NOT_CONFIGURED",
  "UNEXPECTED",
] as const;
export type NoticeErrorCode = (typeof noticeErrorCodes)[number];
export type NoticeActionResult =
  { ok: true; marked: number } | { ok: false; code: NoticeErrorCode };

export const noticeErrorMessages: Readonly<Record<NoticeErrorCode, MessageId>> =
  {
    NOT_PERMITTED: "operations.owner.notices.error.notPermitted",
    DIRECT_SESSION_REQUIRED: "operations.owner.notices.error.directSession",
    INVALID_INPUT: "operations.owner.notices.error.invalid",
    NOT_CONFIGURED: "operations.owner.notices.error.notConfigured",
    UNEXPECTED: "operations.owner.notices.error.unexpected",
  };

const [demoAdmin, demoSeller, demoNewcomer, demoOperator] = demoTeamMembers;
const person = (member: TeamMemberView | undefined) =>
  member ? { name: member.name, email: member.email } : null;

/**
 * Sample records for the demo deploy, which has no database. Times are fixed
 * so screenshots and tests read the same.
 */
export function demoOwnerConsole(viewerUserId: string): OwnerConsoleView {
  const events: ConsoleEventView[] = [
    {
      id: "demo-event-1",
      type: "staff.role_granted",
      at: "2026-10-04T15:20:00Z",
      actor: person(demoAdmin),
      subject: demoSeller?.email ?? null,
      role: "legal_approver",
      reason: "Covers contract review while legal is hiring",
    },
    {
      id: "demo-event-2",
      type: "identity.mfa_enrolled",
      at: "2026-10-02T10:22:00Z",
      actor: person(demoNewcomer),
      subject: null,
      role: null,
      reason: null,
    },
    {
      id: "demo-event-3",
      type: "staff.invited",
      at: "2026-10-02T10:15:00Z",
      actor: person(demoAdmin),
      subject: demoNewcomer?.email ?? null,
      role: "revenue",
      reason: null,
    },
    {
      id: "demo-event-4",
      type: "mnda.settings_changed",
      at: "2026-09-30T09:05:00Z",
      actor: person(demoAdmin),
      subject: "legal@fil-one-internal.test",
      role: null,
      reason: null,
    },
    {
      id: "demo-event-5",
      type: "security.assisted_action.started",
      at: "2026-09-29T16:10:00Z",
      actor: person(demoOperator),
      subject: "Cobalt Orchard Media",
      role: null,
      reason: "Customer asked for help adding a bucket",
    },
  ];
  return {
    mode: "demo",
    viewerUserId,
    notices: {
      state: "ready",
      items: [
        {
          noticeId: "demo-notice-1",
          id: "demo-notice-event-1",
          type: "staff.role_granted",
          at: "2026-10-04T15:20:00Z",
          actor: person(demoOperator),
          subject: demoSeller?.email ?? null,
          role: "finance_approver",
          reason: "Quarter close cover",
        },
      ],
    },
    approvals: {
      unavailable: [],
      items: [
        {
          id: "demo-approval-1",
          control: "price_book_activation",
          name: "North America standard",
          version: 4,
          detail: null,
          requestedBy: demoAdmin?.name ?? null,
          requestedAt: "2026-10-03T13:00:00Z",
          href: "/internal/price-books",
          // The demo reader is the commerce administrator who raised it.
          ownRequest: true,
          selfApproval: {
            id: "demo-price-book-4",
            version: 3,
            priceBookAction: "activate",
          },
        },
        {
          id: "demo-approval-2",
          control: "capability_activation",
          name: "partner",
          version: null,
          detail: null,
          requestedBy: demoOperator?.name ?? null,
          requestedAt: "2026-10-04T09:30:00Z",
          href: "/internal/capabilities",
          ownRequest: false,
          selfApproval: null,
        },
      ],
    },
    capabilities: {
      state: "ready",
      items: [
        "new_business",
        "legal",
        "billing",
        "partner",
        "marketplace",
        "teardown",
      ].map((key) => ({
        key,
        enabled: false,
        recoveryEnabled: false,
        pending: key === "partner",
      })),
    },
    staff: { state: "ready", items: demoTeamMembers },
    assistedSessions: {
      state: "ready",
      items: [
        {
          id: "demo-assisted-1",
          staffName: demoOperator?.name ?? "",
          staffEmail: demoOperator?.email ?? "",
          accountName: "Cobalt Orchard Media",
          reason: "Customer asked for help adding a bucket",
          startedAt: "2026-10-04T15:02:00Z",
          expiresAt: "2026-10-04T15:17:00Z",
        },
      ],
    },
    securityEvents: { state: "ready", items: events },
    selfApprovals: {
      state: "ready",
      items: [
        {
          id: "demo-self-approval-1",
          at: "2026-10-01T17:40:00Z",
          actor: person(demoAdmin),
          control: "channel_policy",
          name: null,
          version: 3,
          detail: "2026-10-15",
          reason: "Quarter start; the second approver is on leave until Monday",
        },
      ],
    },
  };
}
