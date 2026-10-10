import {
  staffNotificationKinds,
  type Permission,
  type StaffNotificationKind,
} from "@clockwork/contracts";
import {
  capabilityApprovalPermission,
  type StaffNotificationStore,
  type SystemCapabilityKey,
} from "@clockwork/db";

/**
 * Which audit events notify whom. This is the one place a domain event is
 * mapped to staff recipients: the outbox handler subscribes to exactly the
 * event types listed in `staffNotificationSources`, writes one notification
 * per recipient, and delivers it.
 *
 * A new notifying event is one entry below, naming its kind (declared in
 * packages/contracts/src/staff-notifications.ts) and how to read its
 * recipients from the record. For example, a partner next step that falls
 * due could be:
 *
 *   "partner.next_step_due": partnerSource("partner.next_step_due"),
 *
 * The person who caused an event is never notified about it. Recipients are
 * kept only while they are staff holding every permission the kind needs, so
 * a deactivated colleague or one whose role changed hears nothing.
 */

/** The outbox payload of an audit event (appendAuditAndOutbox). */
export interface StaffNotificationEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  actor: { kind: string; id: string; display?: string | undefined };
  data: Record<string, unknown>;
}

/** What one event says, before recipients are checked. */
export interface StaffNotificationResolution {
  kind: StaffNotificationKind;
  /** Candidate recipients; each is checked against `permissions`. */
  recipients: readonly string[];
  /** Defaults to the kind's own permissions. */
  permissions?: readonly [Permission, ...Permission[]];
  recordType: string;
  recordId: string;
  href: string;
  subject: string;
  detail?: string | null;
  /** The event's own actor stays a recipient: a requester who may approve
   * their own request is asked like any other approver. */
  includesActor?: boolean;
}

export type StaffNotificationLookups = Pick<
  StaffNotificationStore,
  | "holders"
  | "staffIdByEmail"
  | "canSelfApprove"
  | "mnda"
  | "contract"
  | "handoff"
  | "capabilityRequest"
  | "priceBook"
  | "approvalRequester"
>;

export type StaffNotificationSource = (
  event: StaffNotificationEvent,
  lookups: StaffNotificationLookups,
) => Promise<StaffNotificationResolution | null>;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Approvers for a request: the holders, less the requester unless they may
 * decide their own request (`approval:self`). */
async function approvers(
  lookups: StaffNotificationLookups,
  permissions: readonly [Permission, ...Permission[]],
  requester: string | null,
) {
  const holders = (await lookups.holders(permissions)).map((s) => s.id);
  if (!requester || !holders.includes(requester))
    return { recipients: holders };
  return (await lookups.canSelfApprove(requester))
    ? { recipients: holders, includesActor: true }
    : { recipients: holders.filter((id) => id !== requester) };
}

const mndaHref = (company: string) =>
  `/internal/mndas?q=${encodeURIComponent(company)}`;

function mndaSource(
  kind: StaffNotificationKind,
  options: { countersigner?: boolean } = {},
): StaffNotificationSource {
  return async (event, lookups) => {
    const mnda = await lookups.mnda(event.aggregateId);
    if (!mnda) return null;
    const recipients = [mnda.ownerId];
    if (options.countersigner && mnda.countersignerEmail) {
      const countersigner = await lookups.staffIdByEmail(
        mnda.countersignerEmail,
      );
      if (countersigner) recipients.push(countersigner);
    }
    return {
      kind,
      recipients,
      recordType: "mnda",
      recordId: mnda.id,
      href: mndaHref(mnda.company),
      subject: mnda.company,
    };
  };
}

function contractSource(
  kind: StaffNotificationKind,
  options: { detail?: "rejection" } = {},
): StaffNotificationSource {
  return async (event, lookups) => {
    const contract = await lookups.contract(event.aggregateId);
    if (!contract) return null;
    return {
      kind,
      recipients: [contract.preparerId ?? contract.createdById],
      recordType: "contract",
      recordId: contract.id,
      href: `/internal/contracts/${contract.id}`,
      subject: contract.counterpartyName,
      detail: options.detail === "rejection" ? contract.rejectionReason : null,
    };
  };
}

/** A contract prepared for approval asks every approver but its preparer. */
const contractApprovalRequested: StaffNotificationSource = async (
  event,
  lookups,
) => {
  const contract = await lookups.contract(event.aggregateId);
  if (
    !contract ||
    !contract.approvalRequired ||
    contract.approvalState !== "pending"
  )
    return null;
  const permissions = staffNotificationKinds["contract.approval_requested"]
    .permissions as readonly [Permission, ...Permission[]];
  return {
    kind: "contract.approval_requested",
    ...(await approvers(lookups, permissions, contract.preparerId)),
    recordType: "contract",
    recordId: contract.id,
    href: `/internal/contracts/${contract.id}`,
    subject: contract.counterpartyName,
  };
};

const handoffRequested: StaffNotificationSource = async (event, lookups) => {
  const handoff = await lookups.handoff(event.aggregateId);
  if (!handoff) return null;
  return {
    kind: "handoff.requested",
    recipients: (
      await lookups.holders(["operations:read", "operations:write"])
    ).map((s) => s.id),
    recordType: "handoff",
    recordId: handoff.id,
    href: `/internal/handoffs/${handoff.id}`,
    subject: handoff.counterpartyLegalName,
  };
};

/** The requester follows a handoff from its first contract. */
function handoffStatus(
  kind: StaffNotificationKind,
  options: { detail?: boolean } = {},
): StaffNotificationSource {
  return async (event, lookups) => {
    const handoff = await lookups.handoff(event.aggregateId);
    const contractId = handoff?.contractIds[0];
    if (!handoff || !contractId) return null;
    return {
      kind,
      recipients: [handoff.requestedById],
      recordType: "contract",
      recordId: contractId,
      href: `/internal/contracts/${contractId}`,
      subject: handoff.counterpartyLegalName,
      detail: options.detail ? handoff.decisionNote : null,
    };
  };
}

const capabilityName = (key: string) => key.replaceAll("_", " ");

const capabilityRequested: StaffNotificationSource = async (event, lookups) => {
  const request = await lookups.capabilityRequest(event.aggregateId);
  if (!request || request.status !== "pending") return null;
  const permissions: [Permission, ...Permission[]] = [
    "operations:read",
    capabilityApprovalPermission(request.capabilityKey as SystemCapabilityKey),
  ];
  return {
    kind: "capability.approval_requested",
    ...(await approvers(lookups, permissions, request.requestedBy)),
    permissions,
    recordType: "capability",
    recordId: request.id,
    href: "/internal/capabilities",
    subject: capabilityName(request.capabilityKey),
  };
};

function capabilityDecided(
  kind: StaffNotificationKind,
): StaffNotificationSource {
  return async (event, lookups) => {
    const request = await lookups.capabilityRequest(event.aggregateId);
    if (!request) return null;
    return {
      kind,
      recipients: [request.requestedBy],
      recordType: "capability",
      recordId: request.id,
      href: "/internal/capabilities",
      subject: capabilityName(request.capabilityKey),
      detail: kind === "capability.rejected" ? request.decisionReason : null,
    };
  };
}

async function priceBookSubject(lookups: StaffNotificationLookups, id: string) {
  const book = await lookups.priceBook(id);
  return book
    ? {
        id: book.id,
        subject: `${book.name} (${book.currency} v${book.version})`,
      }
    : null;
}

const priceBookRequested: StaffNotificationSource = async (event, lookups) => {
  const book = await priceBookSubject(lookups, event.aggregateId);
  if (!book) return null;
  const permissions = staffNotificationKinds["price_book.approval_requested"]
    .permissions as readonly [Permission, ...Permission[]];
  return {
    kind: "price_book.approval_requested",
    ...(await approvers(
      lookups,
      permissions,
      text(event.data.activationRequestedBy),
    )),
    recordType: "price_book",
    recordId: book.id,
    href: "/internal/price-books",
    subject: book.subject,
  };
};

const priceBookApproved: StaffNotificationSource = async (event, lookups) => {
  const book = await priceBookSubject(lookups, event.aggregateId);
  const requester = text(event.data.activationRequestedBy);
  if (!book || !requester) return null;
  return {
    kind: "price_book.approved",
    recipients: [requester],
    recordType: "price_book",
    recordId: book.id,
    href: "/internal/price-books",
    subject: book.subject,
  };
};

const priceBookRejected: StaffNotificationSource = async (event, lookups) => {
  const book = await priceBookSubject(lookups, event.aggregateId);
  const approval = text(event.data.rejectedApprovalId);
  const requester = approval ? await lookups.approvalRequester(approval) : null;
  if (!book || !requester) return null;
  return {
    kind: "price_book.rejected",
    recipients: [requester],
    recordType: "price_book",
    recordId: book.id,
    href: "/internal/price-books",
    subject: book.subject,
    detail: text(event.data.reason),
  };
};

export const staffNotificationSources: Readonly<
  Record<string, StaffNotificationSource>
> = {
  // MNDAs: the request's own state events (MndaRepository.update).
  "mnda.awaiting_countersignature": mndaSource("mnda.counterparty_signed", {
    countersigner: true,
  }),
  "mnda.completed": mndaSource("mnda.completed"),
  "mnda.attention": mndaSource("mnda.attention"),
  "mnda.deleted_in_signwell": mndaSource("mnda.attention"),
  "mnda.signwell_mismatch": mndaSource("mnda.attention"),
  "mnda.declined": mndaSource("mnda.declined"),
  "mnda.expired": mndaSource("mnda.expired"),

  // Contracts: approval decisions and signing states (ContractSigningRepository).
  "contract.prepared": contractApprovalRequested,
  "contract.approved": contractSource("contract.approved"),
  "contract.rejected": contractSource("contract.sent_back", {
    detail: "rejection",
  }),
  "contract.signing_awaiting_countersignature": contractSource(
    "contract.counterparty_signed",
  ),
  "contract.signing_completed": contractSource("contract.executed"),
  "contract.signing_attention": contractSource("contract.attention"),
  "contract.deleted_in_signwell": contractSource("contract.attention"),
  "contract.signwell_mismatch": contractSource("contract.attention"),
  "contract.signing_declined": contractSource("contract.declined"),
  "contract.signing_expired": contractSource("contract.expired"),

  // Handoffs (HandoffRequestRepository).
  "handoff.requested": handoffRequested,
  "handoff.taken": handoffStatus("handoff.in_progress"),
  "handoff.completed": handoffStatus("handoff.done"),
  "handoff.declined": handoffStatus("handoff.declined", { detail: true }),

  // Capability switches (DatabaseSystemCapabilityAdmin).
  "system.capability.activation_proposed": capabilityRequested,
  "system.capability.activation_approved": capabilityDecided(
    "capability.approved",
  ),
  "system.capability.activation_rejected": capabilityDecided(
    "capability.rejected",
  ),

  // Price-book activation (the core price_books commands).
  "core.price_books.request_activation": priceBookRequested,
  "core.price_books.activate": priceBookApproved,
  "core.price_books.reject_activation": priceBookRejected,
};
