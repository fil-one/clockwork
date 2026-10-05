import "server-only";

import {
  DatabaseSystemCapabilityAdmin,
  OwnerConsoleRepository,
  pendingApprovalControls,
  StaffTeamRepository,
  type ConsoleAuditEvent,
  type PendingApproval,
  type PendingApprovalControl,
} from "@clockwork/db";

import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import { mayApproveOwnRequests } from "../self-approval/model";
import { teamMemberView } from "../team/server";
import {
  approvalControls,
  demoOwnerConsole,
  type ApprovalControl,
  type ApprovalItemView,
  type ApprovalsView,
  type ConsoleEventView,
  type ConsoleSection,
  type ConsoleSelfApprovalTarget,
  type OwnerConsoleView,
} from "./model";

const requestId = (read: string) =>
  `owner-console-${read}:${crypto.randomUUID()}`;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function field(record: unknown, key: string): unknown {
  return record && typeof record === "object"
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

/**
 * The person, account or address an event is about, read from what the
 * event recorded. Staff events name the person's email; signer and notice
 * changes name the address; account events name the account.
 */
function eventSubject(event: ConsoleAuditEvent): string | null {
  const after = event.after;
  const before = event.before;
  switch (event.eventType) {
    case "mnda.signer_configured":
      return text(field(after, "name")) ?? text(field(after, "email"));
    case "mnda.settings_changed":
      return text(field(after, "noticeEmail"));
    case "security.assisted_action.started":
      return event.accountName;
    default:
      return (
        text(field(after, "email")) ??
        text(field(before, "email")) ??
        event.accountName
      );
  }
}

/** The console's control for a self-approval event's `control`. */
function selfApprovedControl(value: unknown): ApprovalControl | null {
  const control = value === "termination_teardown" ? "termination" : value;
  return typeof control === "string" &&
    (approvalControls as readonly string[]).includes(control)
    ? (control as ApprovalControl)
    : null;
}

export function consoleEventView(event: ConsoleAuditEvent): ConsoleEventView {
  if (event.eventType === "approval.self_approved")
    return {
      id: event.id,
      type: event.eventType,
      at: event.occurredAt.toISOString(),
      actor: event.actor
        ? { name: event.actor.name, email: event.actor.email }
        : null,
      subject: null,
      role: null,
      reason: text(field(event.after, "reason")),
      control: selfApprovedControl(field(event.after, "control")),
    };
  return {
    id: event.id,
    type: event.eventType,
    at: event.occurredAt.toISOString(),
    actor: event.actor
      ? { name: event.actor.name, email: event.actor.email }
      : null,
    subject: eventSubject(event),
    role: event.eventType.startsWith("staff.")
      ? text(field(event.after, "role"))
      : null,
    reason: text(field(event.after, "reason")),
  };
}

/** Runs one read; a failure makes only its own section unavailable. */
async function section<T>(
  name: string,
  read: () => Promise<readonly T[]>,
): Promise<ConsoleSection<T>> {
  try {
    return { state: "ready", items: await read() };
  } catch (error) {
    console.error("Owner console section could not be read", {
      section: name,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { state: "unavailable" };
  }
}

/**
 * What "Approve my own request" acts on for a request the reader raised, when
 * the control is decided in the portal. A price book takes the approval its
 * effective date allows: activation when it is in effect, a schedule when it
 * starts later.
 */
export function selfApprovalTarget(
  pending: Pick<PendingApproval, "control" | "target">,
  today: string,
): ConsoleSelfApprovalTarget | null {
  const target = pending.target;
  if (!target) return null;
  const control: PendingApprovalControl = pending.control;
  if (control !== "price_book_activation")
    return { id: target.id, version: target.version };
  if (!target.date) return null;
  return {
    id: target.id,
    version: target.version,
    priceBookAction: target.date > today ? "schedule_activation" : "activate",
  };
}

/**
 * Every control's open requests, each read on its own: a control that cannot
 * be read is named as unavailable and the others still list theirs.
 */
async function loadApprovals(
  reads: OwnerConsoleRepository,
  viewerUserId: string,
  canApproveOwn: boolean,
  today: string,
): Promise<ApprovalsView> {
  const results = await Promise.all(
    pendingApprovalControls.map(async (control) => ({
      control,
      result: await section(`approvals:${control}`, async () =>
        (
          await reads.pendingApprovals({
            control,
            requestId: requestId(`approvals-${control}`),
          })
        ).map((pending): ApprovalItemView => ({
          id: pending.id,
          control: pending.control,
          name: pending.name,
          version: pending.version,
          detail: pending.detail,
          requestedBy: pending.requestedBy?.name ?? null,
          requestedAt: pending.requestedAt.toISOString(),
          href: pending.href,
          ownRequest: pending.requestedBy?.userId === viewerUserId,
          selfApproval:
            canApproveOwn && pending.requestedBy?.userId === viewerUserId
              ? selfApprovalTarget(pending, today)
              : null,
        })),
      ),
    })),
  );
  return {
    items: results
      .flatMap(({ result }) => (result.state === "ready" ? result.items : []))
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt)),
    unavailable: results
      .filter(({ result }) => result.state === "unavailable")
      .map(({ control }) => control),
  };
}

/**
 * Everything the owner console shows. The page is already limited to
 * `staff:manage`; this decides where the records come from. A session that
 * is not backed by the identity provider (the demo) sees sample records.
 */
export async function loadOwnerConsole(
  now: Date = new Date(),
): Promise<OwnerConsoleView> {
  const session = await getCommerceSession();
  const database = getOptionalServiceDatabase();
  if (!session.providerBacked || !database)
    return demoOwnerConsole(session.userId);
  const reads = new OwnerConsoleRepository(database);
  const organizationId = session.organizationId;
  const [
    notices,
    capabilities,
    staff,
    assistedSessions,
    approvals,
    securityEvents,
    selfApprovals,
  ] = await Promise.all([
    section("notices", async () =>
      (
        await reads.unreadNotices({
          viewerUserId: session.userId,
          requestId: requestId("notices"),
        })
      ).map((notice) => ({
        noticeId: notice.noticeId,
        ...consoleEventView(notice),
      })),
    ),
    section("capabilities", async () =>
      (
        await new DatabaseSystemCapabilityAdmin(database).list({
          requestId: requestId("capabilities"),
        })
      ).map((row) => ({
        key: row.capabilityKey,
        enabled: row.enabled,
        recoveryEnabled: row.recoveryEnabled,
        pending: row.pending !== null,
      })),
    ),
    section("staff", async () => {
      if (!organizationId) throw new Error("STAFF_ORGANIZATION_MISSING");
      return (
        await new StaffTeamRepository(database).list({
          organizationId,
          requestId: requestId("staff"),
        })
      ).map(teamMemberView);
    }),
    section("assisted", async () =>
      (
        await reads.openAssistedSessions({
          now,
          requestId: requestId("assisted"),
        })
      ).map((open) => ({
        id: open.id,
        staffName: open.staff.name,
        staffEmail: open.staff.email,
        accountName: open.accountName,
        reason: open.reason,
        startedAt: open.startedAt.toISOString(),
        expiresAt: open.expiresAt.toISOString(),
      })),
    ),
    loadApprovals(
      reads,
      session.userId,
      mayApproveOwnRequests(session),
      now.toISOString().slice(0, 10),
    ),
    section("security", async () =>
      (
        await reads.securityEvents({
          limit: 50,
          requestId: requestId("security"),
        })
      ).map(consoleEventView),
    ),
    section("selfApprovals", async () =>
      (
        await reads.selfApprovals({
          limit: 20,
          requestId: requestId("self-approvals"),
        })
      ).map((record) => ({
        id: record.id,
        at: record.occurredAt.toISOString(),
        actor: record.actor
          ? { name: record.actor.name, email: record.actor.email }
          : null,
        control: record.control,
        name: record.name,
        version: record.version,
        detail: record.detail,
        reason: record.reason,
      })),
    ),
  ]);
  return {
    mode: "live",
    viewerUserId: session.userId,
    notices,
    approvals,
    capabilities,
    staff,
    assistedSessions,
    securityEvents,
    selfApprovals,
  };
}
