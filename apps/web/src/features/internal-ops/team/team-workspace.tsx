"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import {
  Button,
  EmptyState,
  Input,
  Select,
  StateBanner,
  StatusBadge,
  buttonClassName,
} from "@clockwork/ui";

import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import {
  changeStaffRole,
  deactivateStaffMember,
  inviteStaffMember,
} from "./actions";
import {
  inviteRoles,
  isTeamRole,
  staffRoleLabels,
  teamErrorMessages,
  teamErrorsThatRefresh,
  teamRoles,
  type TeamActionResult,
  type TeamErrorCode,
  type TeamMemberView,
  type TeamView,
} from "./model";
import styles from "./team-workspace.module.css";

type Outcome =
  | { tone: "success"; message: string }
  | { tone: "danger"; code: TeamErrorCode };

const roleSummaries: readonly [string, MessageId][] = [
  ["revenue", "operations.team.roles.revenue"],
  ["commerce_admin", "operations.team.roles.commerceAdmin"],
  ["internal_operator", "operations.team.roles.internalOperator"],
];

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
      <header className={styles.header}>
        <h1>{t("operations.team.title")}</h1>
        <p className={styles.description}>{t("operations.team.description")}</p>
      </header>

      {view.mode === "demo" ? (
        <StateBanner tone="info" title={t("operations.team.demoNotice")} />
      ) : null}
      {view.mode === "unavailable" ? (
        <StateBanner tone="danger" title={t("operations.team.unavailable")} />
      ) : null}

      <div className={styles.feedback}>
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
                : {})}
            />
          </div>
        ) : null}
      </div>

      <section className={styles.panel} aria-labelledby="team-roles">
        <h2 id="team-roles">{t("operations.team.roles.title")}</h2>
        <dl className={styles.roles}>
          {roleSummaries.map(([role, summary]) => (
            <div key={role}>
              <dt>{roleLabel(role)}</dt>
              <dd>{t(summary)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {editable ? (
        <InviteForm
          domains={domains}
          pending={pending}
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
                  roleLabel={roleLabel}
                  onChangeRole={(role) =>
                    run(
                      () =>
                        changeStaffRole({
                          userId: member.userId,
                          role,
                          expectedRowVersion: member.rowVersion,
                        }),
                      () =>
                        t("operations.team.role.saved", {
                          name: member.name,
                          role: roleLabel(role),
                        }),
                    )
                  }
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
  onInvite,
}: {
  domains: string;
  pending: boolean;
  onInvite: (
    person: {
      name: string;
      email: string;
      role: (typeof inviteRoles)[number];
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
          const role =
            text("role") === "commerce_admin" ? "commerce_admin" : "revenue";
          const title = text("title");
          onInvite(
            {
              name: text("name"),
              email: text("email"),
              role,
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
          options={inviteRoles.map((role) => ({
            value: role,
            label: t(staffRoleLabels[role] ?? "role.revenue"),
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

function MemberRow({
  member,
  self,
  editable,
  pending,
  locale,
  roleLabel,
  onChangeRole,
  onDeactivate,
}: {
  member: TeamMemberView;
  self: boolean;
  editable: boolean;
  pending: boolean;
  locale: string;
  roleLabel: (role: string) => string;
  onChangeRole: (role: (typeof teamRoles)[number]) => void;
  onDeactivate: () => void;
}) {
  const t = useTranslations();
  const nameId = useId();
  const roleFieldId = useId();
  const [role, setRole] = useState(member.role);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => setRole(member.role), [member.role]);
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
  const managed = isTeamRole(member.role);
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
          <dd>{roleLabel(member.role)}</dd>
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
            <form
              className={styles.roleForm}
              onSubmit={(event) => {
                event.preventDefault();
                if (isTeamRole(role) && role !== member.role)
                  onChangeRole(role);
              }}
            >
              <label className="cw-sr-only" htmlFor={roleFieldId}>
                {t("operations.team.role.change", { name: member.name })}
              </label>
              <select
                id={roleFieldId}
                className="cw-select"
                value={role}
                disabled={pending}
                onChange={(event) => setRole(event.target.value)}
              >
                {teamRoles.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                variant="secondary"
                size="small"
                disabled={pending || role === member.role}
              >
                {t("operations.team.role.save")}
              </Button>
            </form>
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
      </div>
    </li>
  );
}
