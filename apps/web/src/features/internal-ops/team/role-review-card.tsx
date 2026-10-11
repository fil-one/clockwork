"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button, StateBanner, buttonClassName } from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";

import { grantStaffRole, revokeStaffRole } from "./actions";
import {
  permissionLabels,
  staffRoleLabels,
  teamErrorMessages,
  type TeamActionResult,
  type TeamErrorCode,
} from "./model";
import type { StaffRoleReview } from "./role-review";
import styles from "./team-workspace.module.css";

/** A prepared URL only opens this review; its contents never submit a change. */
export function StaffRoleReviewCard({ review }: { review: StaffRoleReview }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<TeamErrorCode | null>(null);
  const roleLabel = (role: string) =>
    staffRoleLabels[role] ? t(staffRoleLabels[role]) : role;

  function confirm() {
    if (review.state !== "ready" || inFlight.current || completed) return;
    inFlight.current = true;
    setError(null);
    const { request } = review;
    startTransition(async () => {
      const input = {
        userId: request.userId,
        role: request.role,
        expectedRowVersion: request.expectedRowVersion,
        expectedActorUserId: request.actorUserId,
      };
      const result = await (
        request.action === "grant"
          ? grantStaffRole(input)
          : revokeStaffRole(input)
      ).catch((): TeamActionResult => ({ ok: false, code: "UNEXPECTED" }));
      inFlight.current = false;
      if (result.ok) {
        setCompleted(true);
        router.refresh();
      } else setError(result.code);
    });
  }

  const errorCode = review.state === "error" ? review.code : error;
  const errorMessage =
    errorCode === "REVIEW_INVALID"
      ? t("operations.team.review.invalid")
      : errorCode === "REVIEW_ACTOR"
        ? t("operations.team.review.actor")
        : errorCode
          ? t(teamErrorMessages[errorCode], { domains: "" })
          : null;
  return (
    <section className={styles.panel} aria-labelledby="staff-role-review-title">
      <h2 id="staff-role-review-title">{t("operations.team.review.title")}</h2>
      {completed ? (
        <div role="status">
          <StateBanner
            tone="success"
            title={t("operations.team.review.done")}
          />
        </div>
      ) : (
        <>
          {errorMessage ? (
            <div role="alert">
              <StateBanner tone="danger" title={errorMessage} />
            </div>
          ) : null}
          {review.state === "ready" ? (
            <>
              <p>{t("operations.team.review.description")}</p>
              <p>
                <strong>{review.member.name}</strong>
                <br />
                {review.member.email}
              </p>
              <p>
                {t(
                  review.request.action === "grant"
                    ? "operations.team.review.grant"
                    : "operations.team.review.revoke",
                  { role: roleLabel(review.request.role) },
                )}
              </p>
              <dl className={styles.roles}>
                <div>
                  <dt>{t("operations.team.review.before")}</dt>
                  <dd>{review.beforeRoles.map(roleLabel).join(", ")}</dd>
                </div>
                <div>
                  <dt>{t("operations.team.review.after")}</dt>
                  <dd>{review.afterRoles.map(roleLabel).join(", ")}</dd>
                </div>
              </dl>
              <div className={styles.roles}>
                <section
                  aria-label={t("operations.team.review.permissionsBefore")}
                >
                  <h3>{t("operations.team.review.permissionsBefore")}</h3>
                  <ul className={styles.permissionList}>
                    {review.beforePermissions.map((permission) => (
                      <li key={permission}>
                        {t(permissionLabels[permission])}
                      </li>
                    ))}
                  </ul>
                </section>
                <section
                  aria-label={t("operations.team.review.permissionsAfter")}
                >
                  <h3>{t("operations.team.review.permissionsAfter")}</h3>
                  <ul className={styles.permissionList}>
                    {review.afterPermissions.map((permission) => (
                      <li key={permission}>
                        {t(permissionLabels[permission])}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
              <div className={styles.formActions}>
                <Button
                  onClick={confirm}
                  disabled={
                    pending ||
                    error === "STALE" ||
                    error === "ACTOR_CHANGED" ||
                    error === "ROLE_UNCHANGED" ||
                    error === "ROLE_NOT_HELD" ||
                    error === "MEMBER_NOT_FOUND"
                  }
                  aria-busy={pending || undefined}
                >
                  {pending
                    ? t("operations.team.working")
                    : t("operations.team.review.confirm")}
                </Button>
                {error === "RECENT_SIGN_IN_REQUIRED" ? (
                  <Link
                    className={buttonClassName({ variant: "secondary" })}
                    href={`/access/mfa?${new URLSearchParams({ returnTo: review.reviewUrl })}`}
                  >
                    {t("operations.team.verify")}
                  </Link>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
      <Link href="/internal/team">
        {t(
          completed
            ? "operations.team.review.back"
            : "operations.team.review.cancel",
        )}
      </Link>
    </section>
  );
}
