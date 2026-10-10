"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import type { OrganizationInvite } from "@clockwork/db";
import type { OrganizationSide } from "@clockwork/contracts";
import { Button, Input, Select, StateBanner, StatusBadge } from "@clockwork/ui";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { CopyableId } from "../copyable-id";
import { formatContractDate } from "../contracts/copy";
import { handoffDay } from "../handoff/model";
import { inviteToOrganization, revokeInvitation } from "./actions";
import { memberRoleLabels, organizationErrorMessage } from "./model";
import styles from "../handoff/handoff.module.css";

const wide = styles.wide ?? "";

const sideRoles: Readonly<Record<OrganizationSide, readonly string[]>> = {
  customer: ["owner", "admin", "billing", "member"],
  channel_partner: ["partner_admin", "partner_seller"],
  referral_partner: ["partner_admin", "partner_seller"],
  fil_one: [],
};

/** An invite link as an absolute address, ready to paste into an email. */
function InviteLink({ path, label }: { path: string; label: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return <CopyableId value={`${origin}${path}`} label={label} />;
}

/** Invitations into one organization: create one, then copy its link. */
export function OrganizationInvites({
  organizationId,
  side,
  invites,
  canWrite,
}: {
  organizationId: string;
  side: OrganizationSide;
  /** Null when invites cannot be read here. */
  invites: readonly OrganizationInvite[] | null;
  canWrite: boolean;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const [outcome, setOutcome] = useState<
    | { tone: "success"; email: string; path: string }
    | { tone: "revoked"; email: string }
    | { tone: "danger"; code: string }
    | null
  >(null);
  const [pending, startTransition] = useTransition();
  const roles = sideRoles[side];
  const roleLabel = (role: string) => {
    const label = memberRoleLabels[role];
    return label ? t(label) : role;
  };
  const linkLabel = t("operations.organizations.invites.link");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const email = text("email");
    setOutcome(null);
    startTransition(async () => {
      const result = await inviteToOrganization({
        organizationId,
        email,
        role: text("role"),
      }).catch(() => ({ ok: false as const, code: "UNEXPECTED" }));
      if (result.ok) {
        form.reset();
        setOutcome({ tone: "success", email, path: result.value.path });
        router.refresh();
        return;
      }
      setOutcome({ tone: "danger", code: result.code });
    });
  }

  function revoke(invite: OrganizationInvite) {
    setOutcome(null);
    startTransition(async () => {
      const result = await revokeInvitation({
        organizationId,
        inviteId: invite.inviteId,
      }).catch(() => ({ ok: false as const, code: "UNEXPECTED" }));
      if (result.ok) {
        setOutcome({ tone: "revoked", email: invite.email });
        router.refresh();
        return;
      }
      setOutcome({ tone: "danger", code: result.code });
    });
  }

  return (
    <section className={styles.card} aria-labelledby="organization-invites">
      <div>
        <h2 id="organization-invites">
          {t("operations.organizations.invites.title")}
        </h2>
        <p className={styles.muted}>
          {t("operations.organizations.invites.description")}
        </p>
      </div>
      {outcome?.tone === "success" ? (
        <div role="status">
          <StateBanner
            tone="success"
            title={t("operations.organizations.invites.done", {
              email: outcome.email,
            })}
            description={<InviteLink path={outcome.path} label={linkLabel} />}
          />
        </div>
      ) : null}
      {outcome?.tone === "revoked" ? (
        <div role="status">
          <StateBanner
            tone="success"
            title={t("operations.organizations.invites.revoked", {
              email: outcome.email,
            })}
          />
        </div>
      ) : null}
      {outcome?.tone === "danger" ? (
        <div role="alert">
          <StateBanner
            tone="danger"
            title={t(organizationErrorMessage(outcome.code))}
          />
        </div>
      ) : null}
      {canWrite && roles.length > 0 ? (
        <form className={styles.form} onSubmit={submit}>
          <Input
            label={t("operations.organizations.invites.email")}
            name="email"
            type="email"
            maxLength={320}
            required
          />
          <Select
            label={t("operations.organizations.invites.role")}
            name="role"
            defaultValue={roles[0]}
            options={roles.map((role) => ({
              value: role,
              label: roleLabel(role),
            }))}
          />
          <div className={`${styles.actions} ${wide}`}>
            <Button type="submit" variant="primary" loading={pending}>
              {pending
                ? t("operations.organizations.invites.pending")
                : t("operations.organizations.invites.submit")}
            </Button>
          </div>
        </form>
      ) : null}
      {invites === null ? (
        <p className={styles.muted}>
          {t("operations.organizations.invites.unavailable")}
        </p>
      ) : invites.length === 0 ? (
        <p className={styles.muted}>
          {t("operations.organizations.invites.empty")}
        </p>
      ) : (
        <ul className={styles.list}>
          {invites.map((invite) => (
            <li key={invite.inviteId}>
              <span className={styles.rowHeading}>
                <strong>{invite.email}</strong>
                <span>{roleLabel(invite.role)}</span>
                <StatusBadge
                  tone={
                    invite.state === "pending" || invite.state === "void"
                      ? "warning"
                      : invite.state === "accepted"
                        ? "success"
                        : "neutral"
                  }
                >
                  {t(`operations.organizations.invites.state.${invite.state}`, {
                    date: formatContractDate(
                      handoffDay(invite.acceptedAt ?? invite.expiresAt),
                      locale,
                    ),
                  })}
                </StatusBadge>
              </span>
              {invite.path ? (
                <InviteLink path={invite.path} label={linkLabel} />
              ) : null}
              {canWrite &&
              (invite.state === "pending" || invite.state === "void") ? (
                <span className={styles.actions}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    disabled={pending}
                    aria-label={`${t("operations.organizations.invites.revoke")}: ${invite.email}`}
                    onClick={() => revoke(invite)}
                  >
                    {t("operations.organizations.invites.revoke")}
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
