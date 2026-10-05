import "server-only";

import {
  DatabaseSystemCapabilityAdmin,
  OwnerConsoleRepository,
  pendingApprovalControls,
  StaffTeamRepository,
  type ConsoleAuditEvent,
} from "@clockwork/db";

import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import { teamMemberView } from "../team/server";
import {
  demoOwnerConsole,
  type ApprovalItemView,
  type ApprovalsView,
  type ConsoleEventView,
  type ConsoleSection,
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

export function consoleEventView(event: ConsoleAuditEvent): ConsoleEventView {
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
 * Every control's open requests, each read on its own: a control that cannot
 * be read is named as unavailable and the others still list theirs.
 */
async function loadApprovals(
  reads: OwnerConsoleRepository,
  viewerUserId: string,
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
    loadApprovals(reads, session.userId),
    section("security", async () =>
      (
        await reads.securityEvents({
          limit: 50,
          requestId: requestId("security"),
        })
      ).map(consoleEventView),
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
  };
}
