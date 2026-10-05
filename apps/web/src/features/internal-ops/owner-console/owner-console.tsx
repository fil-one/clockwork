"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button, StateBanner, StatusBadge } from "@clockwork/ui";

import type { MessageId } from "@/src/i18n";
import { useTranslations } from "@/src/i18n/client";

import { LocalTimestamp } from "../local-timestamp";
import { staffRoleLabels } from "../team/model";
import { RoleChips } from "../team/team-workspace";
import { AccessMatrix } from "./access-matrix";
import { markNoticesRead } from "./actions";
import { ApprovalsPanel } from "./approvals-panel";
import {
  capabilityLabels,
  eventMessages,
  noticeErrorMessages,
  type ConsoleEventView,
  type ConsoleSection,
  type NoticeActionResult,
  type NoticeErrorCode,
  type NoticeView,
  type OwnerConsoleView,
} from "./model";
import styles from "./owner-console.module.css";
import { Panel, PanelLink, SectionBody } from "./panel";

/** A role's name in the reader's language. */
function useRoleLabel(): (role: string) => string {
  const t = useTranslations();
  return (role) => (staffRoleLabels[role] ? t(staffRoleLabels[role]) : role);
}

/** One event as a sentence: who did what, to whom. */
export function useEventSentence(): (event: ConsoleEventView) => string {
  const t = useTranslations();
  const roleLabel = useRoleLabel();
  return (event) =>
    t(eventMessages[event.type] ?? "operations.owner.event.other", {
      actor: event.actor?.name ?? t("operations.owner.event.systemActor"),
      subject: event.subject ?? t("operations.owner.event.unknownSubject"),
      role: event.role ? roleLabel(event.role) : "",
    });
}

function EventLine({ event }: { event: ConsoleEventView }) {
  const t = useTranslations();
  const sentence = useEventSentence();
  return (
    <>
      <p className={styles.eventText}>
        <bdi>{sentence(event)}</bdi>
      </p>
      {event.reason ? (
        <p className={styles.reason}>
          {t("operations.owner.event.reason", { reason: event.reason })}
        </p>
      ) : null}
      <p className={styles.time}>
        <LocalTimestamp value={event.at} />
      </p>
    </>
  );
}

function NoticeItem({
  notice,
  editable,
  pending,
  onRead,
}: {
  notice: NoticeView;
  editable: boolean;
  pending: boolean;
  onRead: () => void;
}) {
  const t = useTranslations();
  const textId = useId();
  return (
    <li className={styles.item}>
      <div className={styles.itemText} id={textId}>
        <EventLine event={notice} />
      </div>
      {editable ? (
        <Button
          variant="quiet"
          size="small"
          disabled={pending}
          aria-describedby={textId}
          onClick={onRead}
        >
          {t("operations.owner.notices.markRead")}
        </Button>
      ) : null}
    </li>
  );
}

function NoticesPanel({
  notices,
  editable,
}: {
  notices: ConsoleSection<NoticeView>;
  editable: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<NoticeErrorCode | null>(null);
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const visible: ConsoleSection<NoticeView> =
    notices.state === "ready"
      ? {
          state: "ready",
          items: notices.items.filter(
            (notice) => !cleared.has(notice.noticeId),
          ),
        }
      : notices;
  const count = visible.state === "ready" ? visible.items.length : undefined;

  function mark(ids: readonly string[] | "all") {
    setError(null);
    setAnnouncement("");
    startTransition(async () => {
      const result = await markNoticesRead({ noticeIds: ids }).catch(
        (): NoticeActionResult => ({ ok: false, code: "UNEXPECTED" }),
      );
      if (!result.ok) {
        setError(result.code);
        return;
      }
      const marked =
        ids === "all" && notices.state === "ready"
          ? notices.items.map((notice) => notice.noticeId)
          : ids === "all"
            ? []
            : ids;
      setCleared((previous) => new Set([...previous, ...marked]));
      setAnnouncement(
        t(
          ids === "all"
            ? "operations.owner.notices.allRead"
            : "operations.owner.notices.oneRead",
        ),
      );
      router.refresh();
    });
  }

  return (
    <Panel
      id="owner-notices"
      title={t("operations.owner.notices.title")}
      description={t("operations.owner.notices.description")}
      {...(count !== undefined ? { count } : {})}
      action={
        editable && count ? (
          <Button
            variant="secondary"
            size="small"
            disabled={pending}
            onClick={() => mark("all")}
          >
            {t("operations.owner.notices.markAll")}
          </Button>
        ) : undefined
      }
    >
      <p className="cw-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error ? (
        <div role="alert">
          <StateBanner tone="danger" title={t(noticeErrorMessages[error])} />
        </div>
      ) : null}
      <SectionBody section={visible} empty="operations.owner.notices.empty">
        {(items) => (
          <ul className={styles.list}>
            {items.map((notice) => (
              <NoticeItem
                key={notice.noticeId}
                notice={notice}
                editable={editable}
                pending={pending}
                onRead={() => mark([notice.noticeId])}
              />
            ))}
          </ul>
        )}
      </SectionBody>
    </Panel>
  );
}

function CapabilitiesPanel({
  capabilities,
}: {
  capabilities: OwnerConsoleView["capabilities"];
}) {
  const t = useTranslations();
  return (
    <Panel
      id="owner-capabilities"
      title={t("operations.owner.capabilities.title")}
      description={t("operations.owner.capabilities.description")}
      action={
        <PanelLink href="/internal/capabilities">
          {t("operations.owner.capabilities.open")}
        </PanelLink>
      }
    >
      <SectionBody
        section={capabilities}
        empty="operations.owner.capabilities.empty"
      >
        {(items) => (
          <ul className={styles.list}>
            {items.map((capability) => {
              const label = capabilityLabels[capability.key];
              return (
                <li key={capability.key} className={styles.switchRow}>
                  <strong>{label ? t(label) : capability.key}</strong>
                  <span className={styles.badges}>
                    <StatusBadge
                      tone={capability.enabled ? "success" : "neutral"}
                    >
                      {t(
                        capability.enabled
                          ? "operations.owner.capabilities.newOn"
                          : "operations.owner.capabilities.newOff",
                      )}
                    </StatusBadge>
                    <StatusBadge
                      tone={capability.recoveryEnabled ? "success" : "neutral"}
                    >
                      {t(
                        capability.recoveryEnabled
                          ? "operations.owner.capabilities.recoveryOn"
                          : "operations.owner.capabilities.recoveryOff",
                      )}
                    </StatusBadge>
                    {capability.pending ? (
                      <StatusBadge tone="warning">
                        {t("operations.owner.capabilities.pending")}
                      </StatusBadge>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionBody>
    </Panel>
  );
}

function StaffPanel({ staff }: { staff: OwnerConsoleView["staff"] }) {
  const t = useTranslations();
  const roleLabel = useRoleLabel();
  return (
    <Panel
      id="owner-staff"
      title={t("operations.owner.staff.title")}
      description={t("operations.owner.staff.description")}
      wide
      action={
        <PanelLink href="/internal/team">
          {t("operations.owner.staff.open")}
        </PanelLink>
      }
    >
      <SectionBody section={staff} empty="operations.owner.staff.empty">
        {(items) => (
          <ul className={styles.list}>
            {items.map((member) => (
              <li key={member.userId} className={styles.staffRow}>
                <div className={styles.itemText}>
                  <strong>
                    <bdi>{member.name}</bdi>
                  </strong>
                  <span className={styles.muted}>
                    <bdi>{member.email}</bdi>
                  </span>
                </div>
                <RoleChips roles={member.roles} roleLabel={roleLabel} />
                {member.mfa.state === "unknown" ? (
                  <StatusBadge tone="warning">
                    {t("operations.team.mfa.unknown")}
                  </StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionBody>
    </Panel>
  );
}

function AssistedPanel({
  sessions,
}: {
  sessions: OwnerConsoleView["assistedSessions"];
}) {
  const t = useTranslations();
  return (
    <Panel
      id="owner-assisted"
      title={t("operations.owner.assisted.title")}
      description={t("operations.owner.assisted.description")}
      action={
        <PanelLink href="/internal/assisted">
          {t("operations.owner.assisted.open")}
        </PanelLink>
      }
    >
      <SectionBody section={sessions} empty="operations.owner.assisted.empty">
        {(items) => (
          <ul className={styles.list}>
            {items.map((session) => (
              <li key={session.id} className={styles.item}>
                <div className={styles.itemText}>
                  <p className={styles.eventText}>
                    <bdi>
                      {t("operations.owner.assisted.line", {
                        name: session.staffName,
                        account: session.accountName,
                      })}
                    </bdi>
                  </p>
                  <p className={styles.reason}>
                    {t("operations.owner.event.reason", {
                      reason: session.reason,
                    })}
                  </p>
                  <p className={styles.time}>
                    {t("operations.owner.assisted.expires")}{" "}
                    <LocalTimestamp value={session.expiresAt} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionBody>
    </Panel>
  );
}

function EventsPanel({
  id,
  title,
  description,
  events,
  empty,
  wide = false,
}: {
  id: string;
  title: string;
  description: string;
  events: ConsoleSection<ConsoleEventView>;
  empty: MessageId;
  wide?: boolean;
}) {
  return (
    <Panel id={id} title={title} description={description} wide={wide}>
      <SectionBody section={events} empty={empty}>
        {(items) => (
          <ol className={styles.list}>
            {items.map((event) => (
              <li key={event.id} className={styles.item}>
                <div className={styles.itemText}>
                  <EventLine event={event} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionBody>
    </Panel>
  );
}

/**
 * The commerce administrator's overview: what needs them first, then what is
 * true right now, then the record and the rules.
 */
export function OwnerConsole({ view }: { view: OwnerConsoleView }) {
  const t = useTranslations();
  const editable = view.mode === "live";
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <h1>{t("operations.owner.title")}</h1>
        <p>{t("operations.owner.description")}</p>
      </header>

      {view.mode === "demo" ? (
        <StateBanner tone="info" title={t("operations.owner.demoNotice")} />
      ) : null}

      <div className={styles.grid}>
        <NoticesPanel notices={view.notices} editable={editable} />
        <ApprovalsPanel approvals={view.approvals} />
        <CapabilitiesPanel capabilities={view.capabilities} />
        <AssistedPanel sessions={view.assistedSessions} />
        <StaffPanel staff={view.staff} />
        <EventsPanel
          id="owner-security"
          title={t("operations.owner.security.title")}
          description={t("operations.owner.security.description")}
          events={view.securityEvents}
          empty="operations.owner.security.empty"
          wide
        />
        <Panel
          id="owner-matrix"
          title={t("operations.owner.matrix.title")}
          description={t("operations.owner.matrix.description")}
          wide
        >
          <AccessMatrix />
        </Panel>
      </div>
    </main>
  );
}
