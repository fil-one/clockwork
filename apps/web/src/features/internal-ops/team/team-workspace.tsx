"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import {
  Button,
  Dialog,
  EmptyState,
  Input,
  PageHeader,
  Select,
  StateBanner,
  StatusBadge,
  Tag,
  Textarea,
  buttonClassName,
} from "@clockwork/ui";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import {
  deactivateStaffMember,
  grantStaffRole,
  inviteStaffMember,
  revokeStaffRole,
} from "./actions";
import {
  inviteRoles,
  isTeamRole,
  permissionLabels,
  staffPermissions,
  staffRoleLabels,
  staffRoleSummaries,
  teamErrorMessages,
  teamErrorsThatRefresh,
  teamRoles,
  type TeamActionResult,
  type TeamErrorCode,
  type TeamMemberView,
  type TeamRole,
  type TeamView,
} from "./model";
import { SessionExpiredReload } from "../session-expiry";
import styles from "./team-workspace.module.css";

type Outcome =
  | { tone: "success"; message: string }
  | { tone: "danger"; code: TeamErrorCode };

const reasonLimit = 500;

/**
 * The refusal in the reader's words, with the sign-in check or the session
 * reload when it applies.
 */
function OutcomeBanner({
  outcome,
  domains,
  onReloaded,
}: {
  outcome: Outcome | null;
  domains: string;
  onReloaded: () => void;
}) {
  const t = useTranslations();
  return (
    <>
      <p className="cw-sr-only" role="status" aria-live="polite">
        {outcome?.tone === "success" ? outcome.message : ""}
      </p>
      {outcome?.tone === "success" ? (
        <StateBanner tone="success" title={outcome.message} />
      ) : null}
      {outcome?.tone === "danger" ? (
        <div role="alert">
          <StateBanner
            tone="danger"
            title={t(teamErrorMessages[outcome.code], { domains })}
            {...(outcome.code === "RECENT_SIGN_IN_REQUIRED"
              ? {
                  action: (
                    <Link
                      className={buttonClassName({
                        variant: "secondary",
                        size: "small",
                      })}
                      href="/access/mfa"
                    >
                      {t("operations.team.verify")}
                    </Link>
                  ),
                }
              : outcome.code === "SESSION_EXPIRED"
                ? { action: <SessionExpiredReload onReloaded={onReloaded} /> }
                : {})}
          />
        </div>
      ) : null}
    </>
  );
}

export function TeamWorkspace({ view }: { view: TeamView }) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();
  const editable = view.mode === "live";
  const domains = new Intl.ListFormat(locale, {
    style: "short",
    type: "disjunction",
  }).format(view.emailDomains);
  const roleLabel = (role: string) =>
    staffRoleLabels[role] ? t(staffRoleLabels[role]) : role;

  /** Runs one change, then rereads the team so the list matches the database. */
  function run(
    change: () => Promise<TeamActionResult>,
    success: () => string,
    after?: () => void,
  ) {
    setOutcome(null);
    startTransition(async () => {
      const result = await change().catch((): TeamActionResult => ({
        ok: false,
        code: "UNEXPECTED",
      }));
      if (result.ok) {
        setOutcome({ tone: "success", message: success() });
        after?.();
        router.refresh();
        return;
      }
      setOutcome({ tone: "danger", code: result.code });
      if (teamErrorsThatRefresh.has(result.code)) router.refresh();
    });
  }

  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.team.title")}
        description={t("operations.team.description")}
      />

      {view.mode === "demo" ? (
        <StateBanner tone="info" title={t("operations.team.demoNotice")} />
      ) : null}
      {view.mode === "unavailable" ? (
        <StateBanner tone="danger" title={t("operations.team.unavailable")} />
      ) : null}

      <div className={styles.feedback}>
        <OutcomeBanner
          outcome={outcome}
          domains={domains}
          onReloaded={() => setOutcome(null)}
        />
      </div>

      <section className={styles.panel} aria-labelledby="team-roles">
        <h2 id="team-roles">{t("operations.team.roles.title")}</h2>
        <p className={styles.note}>{t("operations.team.roles.combine")}</p>
        <dl className={styles.roles}>
          {teamRoles.map((role) => (
            <div key={role}>
              <dt>{roleLabel(role)}</dt>
              <dd>{t(staffRoleSummaries[role])}</dd>
            </div>
          ))}
        </dl>
      </section>

      {editable ? (
        <InviteForm
          domains={domains}
          pending={pending}
          roleLabel={roleLabel}
          onInvite={(person, reset) =>
            run(
              () => inviteStaffMember(person),
              () =>
                t("operations.team.invite.done", {
                  name: person.name,
                  email: person.email,
                }),
              reset,
            )
          }
        />
      ) : null}

      <section className={styles.panel} aria-labelledby="team-people">
        <h2 id="team-people">{t("operations.team.list.title")}</h2>
        {view.members.length === 0 && view.mode !== "unavailable" ? (
          <EmptyState
            title={t("operations.team.list.empty.title")}
            description={t("operations.team.list.empty.description")}
          />
        ) : (
          <>
            <div className={styles.columns} aria-hidden="true">
              <span>{t("operations.team.column.name")}</span>
              <span>{t("operations.team.column.role")}</span>
              <span>{t("operations.team.column.mfa")}</span>
              <span>{t("operations.team.column.added")}</span>
              <span>
                {editable ? t("operations.team.column.actions") : null}
              </span>
            </div>
            <ul className={styles.members}>
              {view.members.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  self={member.userId === view.actorUserId}
                  editable={editable}
                  pending={pending}
                  locale={locale}
                  domains={domains}
                  roleLabel={roleLabel}
                  onDeactivate={() =>
                    run(
                      () =>
                        deactivateStaffMember({
                          userId: member.userId,
                          expectedRowVersion: member.rowVersion,
                        }),
                      () =>
                        t("operations.team.deactivate.done", {
                          name: member.name,
                        }),
                    )
                  }
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function InviteForm({
  domains,
  pending,
  roleLabel,
  onInvite,
}: {
  domains: string;
  pending: boolean;
  roleLabel: (role: string) => string;
  onInvite: (
    person: {
      name: string;
      email: string;
      role: TeamRole;
      title?: string;
    },
    reset: () => void,
  ) => void;
}) {
  const t = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <section className={styles.panel} aria-labelledby="team-invite">
      <h2 id="team-invite">{t("operations.team.invite.title")}</h2>
      <p className={styles.note}>{t("operations.team.invite.description")}</p>
      <form
        ref={formRef}
        className={styles.inviteForm}
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const text = (name: string) => {
            const value = values.get(name);
            return typeof value === "string" ? value.trim() : "";
          };
          const chosen = text("role");
          const title = text("title");
          onInvite(
            {
              name: text("name"),
              email: text("email"),
              role: isTeamRole(chosen) ? chosen : "revenue",
              ...(title ? { title } : {}),
            },
            () => formRef.current?.reset(),
          );
        }}
      >
        <Input
          label={t("operations.team.invite.name")}
          name="name"
          autoComplete="off"
          maxLength={180}
          required
        />
        <Input
          label={t("operations.team.invite.email")}
          name="email"
          type="email"
          autoComplete="off"
          maxLength={320}
          help={t("operations.team.invite.emailHelp", { domains })}
          required
        />
        <Select
          label={t("operations.team.invite.role")}
          name="role"
          defaultValue="revenue"
          help={t("operations.team.invite.roleHelp")}
          options={inviteRoles.map((role) => ({
            value: role,
            label: roleLabel(role),
          }))}
        />
        <Input
          label={t("operations.team.invite.jobTitle")}
          optionalLabel={t("operations.team.invite.optional")}
          name="title"
          autoComplete="off"
          maxLength={180}
        />
        <div className={styles.formActions}>
          <Button
            type="submit"
            loading={pending}
            loadingLabel={t("operations.team.invite.pending")}
          >
            {t("operations.team.invite.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** A person's roles as neutral tags, the primary one first. Roles say what
 * someone may do, not where anything stands, so they carry no status tone. */
export function RoleChips({
  roles,
  roleLabel,
}: {
  roles: readonly string[];
  roleLabel: (role: string) => string;
}) {
  return (
    <ul className={styles.chips}>
      {roles.map((role) => (
        <li key={role}>
          <Tag>{roleLabel(role)}</Tag>
        </li>
      ))}
    </ul>
  );
}

function MemberRow({
  member,
  self,
  editable,
  pending,
  locale,
  domains,
  roleLabel,
  onDeactivate,
}: {
  member: TeamMemberView;
  self: boolean;
  editable: boolean;
  pending: boolean;
  locale: string;
  domains: string;
  roleLabel: (role: string) => string;
  onDeactivate: () => void;
}) {
  const t = useTranslations();
  const nameId = useId();
  const permissionsId = useId();
  const [confirming, setConfirming] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    // Move focus into the confirmation when it opens and back when it closes,
    // so a keyboard reader is never left on a control that disappeared.
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) removeRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value));
  const managed = member.roles.every(isTeamRole);
  const canAct = editable && !self && managed;
  const mfa =
    member.mfa.state === "verified"
      ? t("operations.team.mfa.verified", { date: date(member.mfa.at) })
      : t(
          member.mfa.state === "enrolled"
            ? "operations.team.mfa.enrolled"
            : "operations.team.mfa.unknown",
        );

  return (
    <li className={styles.member} aria-labelledby={nameId}>
      <div className={styles.identity}>
        <strong id={nameId}>
          <bdi>{member.name}</bdi>
        </strong>
        {self ? (
          <StatusBadge tone="info">{t("operations.team.you")}</StatusBadge>
        ) : null}
        <span className={styles.email}>
          <span className="cw-sr-only">
            {t("operations.team.column.email")}:{" "}
          </span>
          <bdi>{member.email}</bdi>
        </span>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>{t("operations.team.column.role")}</dt>
          <dd>
            <RoleChips roles={member.roles} roleLabel={roleLabel} />
          </dd>
        </div>
        <div>
          <dt>{t("operations.team.column.mfa")}</dt>
          <dd>
            <StatusBadge
              tone={member.mfa.state === "unknown" ? "warning" : "success"}
            >
              {mfa}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt>{t("operations.team.column.added")}</dt>
          <dd>{date(member.addedAt)}</dd>
        </div>
      </dl>
      <div className={styles.access}>
        {self && editable ? (
          <p className={styles.note}>{t("operations.team.self")}</p>
        ) : null}
        {editable && !self && !managed ? (
          <p className={styles.note}>
            {t("operations.team.role.managedElsewhere")}
          </p>
        ) : null}
        {canAct && !confirming ? (
          <>
            <RolesDialog
              member={member}
              nameId={nameId}
              domains={domains}
              disabled={pending}
              roleLabel={roleLabel}
            />
            <button
              ref={removeRef}
              type="button"
              className={buttonClassName({ variant: "quiet", size: "small" })}
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              {t("operations.team.deactivate")}
            </button>
          </>
        ) : null}
        {canAct && confirming ? (
          <div
            className={styles.confirm}
            role="group"
            aria-labelledby={`${nameId}-confirm`}
          >
            <p id={`${nameId}-confirm`}>
              {t("operations.team.deactivate.confirm", { name: member.name })}
            </p>
            <div className={styles.formActions}>
              <button
                ref={confirmRef}
                type="button"
                className={buttonClassName({
                  variant: "danger",
                  size: "small",
                })}
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={onDeactivate}
              >
                {pending
                  ? t("operations.team.working")
                  : t("operations.team.deactivate")}
              </button>
              <Button
                variant="secondary"
                size="small"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                {t("operations.team.deactivate.keep")}
              </Button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className={`${buttonClassName({ variant: "quiet", size: "small" })} ${styles.disclosure}`}
          aria-expanded={showPermissions}
          aria-controls={permissionsId}
          aria-describedby={nameId}
          onClick={() => setShowPermissions((open) => !open)}
        >
          {t("operations.team.permissions.show")}
        </button>
      </div>
      <div
        id={permissionsId}
        className={styles.permissions}
        hidden={!showPermissions}
      >
        {showPermissions ? (
          <EffectivePermissions name={member.name} roles={member.roles} />
        ) : null}
      </div>
    </li>
  );
}

/** Everything a person can do, from every role they hold. */
function EffectivePermissions({
  name,
  roles,
}: {
  name: string;
  roles: readonly string[];
}) {
  const t = useTranslations();
  const held = staffPermissions(roles);
  return (
    <>
      <p className={styles.note}>
        {t("operations.team.permissions.title", { name })}
      </p>
      <ul className={styles.permissionList}>
        {held.map((permission) => (
          <li key={permission}>{t(permissionLabels[permission])}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * Adds or removes one role at a time. Each change is its own record with an
 * optional note, and the list is reread after it, so the dialog always shows
 * the roles as they are now.
 */
function RolesDialog({
  member,
  nameId,
  domains,
  disabled,
  roleLabel,
}: {
  member: TeamMemberView;
  /** The row's name, which describes the button that opens the dialog. */
  nameId: string;
  domains: string;
  disabled: boolean;
  roleLabel: (role: string) => string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const reasonId = useId().replaceAll(":", "");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();
  const onlyRole = member.roles.length === 1;

  function change(kind: "grant" | "revoke", role: TeamRole) {
    setOutcome(null);
    const note = reason.trim();
    startTransition(async () => {
      const input = {
        userId: member.userId,
        role,
        expectedRowVersion: member.rowVersion,
        ...(note ? { reason: note } : {}),
      };
      const result = await (
        kind === "grant" ? grantStaffRole(input) : revokeStaffRole(input)
      ).catch((): TeamActionResult => ({ ok: false, code: "UNEXPECTED" }));
      if (result.ok) {
        setOutcome({
          tone: "success",
          message: t(
            kind === "grant"
              ? "operations.team.role.granted"
              : "operations.team.role.revoked",
            { name: member.name, role: roleLabel(role) },
          ),
        });
        setReason("");
        router.refresh();
        return;
      }
      setOutcome({ tone: "danger", code: result.code });
      if (teamErrorsThatRefresh.has(result.code)) router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setOutcome(null);
      }}
      closeLabel={t("common.close")}
      title={t("operations.team.role.dialog.title", { name: member.name })}
      description={t("operations.team.role.dialog.description")}
      trigger={
        <Button
          variant="secondary"
          size="small"
          disabled={disabled}
          aria-describedby={nameId}
        >
          {t("operations.team.role.change")}
        </Button>
      }
    >
      <div className={styles.dialogBody}>
        <OutcomeBanner
          outcome={outcome}
          domains={domains}
          onReloaded={() => setOutcome(null)}
        />
        <ul className={styles.roleOptions}>
          {teamRoles.map((role) => {
            const held = member.roles.includes(role);
            const primary = member.role === role;
            const labelId = `${reasonId}-${role}`;
            return (
              <li key={role} className={styles.roleOption}>
                <div>
                  <strong id={labelId}>{roleLabel(role)}</strong>
                  {held ? (
                    <StatusBadge tone="success">
                      {t("operations.team.role.held")}
                    </StatusBadge>
                  ) : null}
                  {primary ? (
                    <span className={styles.primaryNote}>
                      {t("operations.team.role.primary")}
                    </span>
                  ) : null}
                  <p>{t(staffRoleSummaries[role])}</p>
                </div>
                {held ? (
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={pending || onlyRole}
                    aria-describedby={labelId}
                    onClick={() => change("revoke", role)}
                  >
                    {t("operations.team.role.remove")}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="small"
                    disabled={pending}
                    aria-describedby={labelId}
                    onClick={() => change("grant", role)}
                  >
                    {t("operations.team.role.add")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {onlyRole ? (
          <p className={styles.note}>{t("operations.team.role.onlyRole")}</p>
        ) : null}
        <Textarea
          id={reasonId}
          label={t("operations.team.role.reason")}
          optionalLabel={t("operations.team.invite.optional")}
          help={t("operations.team.role.reasonHelp")}
          value={reason}
          maxLength={reasonLimit}
          rows={2}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </div>
    </Dialog>
  );
}
