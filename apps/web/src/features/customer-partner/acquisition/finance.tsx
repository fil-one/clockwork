"use client";
import { useTranslations } from "@/src/i18n/client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CustomerAcquisitionRequest } from "@clockwork/domain/core";
import { resolveCustomerAcquisition } from "./actions";
import {
  AdministrationPage,
  styles,
  StatusPill,
} from "@/src/features/internal-ops/administration-safety/ui";
function field(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
export function AcquisitionFinance({
  requests,
  demo,
  available,
}: {
  requests: readonly CustomerAcquisitionRequest[];
  demo: boolean;
  available: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  return (
    <AdministrationPage
      eyebrow="Commercial operations"
      title="Customer service requests"
      description="Review accepted offers and link separately verified trial or PAYG service records. A request does not authorize provider provisioning or billing cutover."
    >
      <p>
        <Link href="/internal/payg-offers">
          Manage policies, verified trials and PAYG enrollments
        </Link>
      </p>
      {demo ? (
        <p className={styles.roleNotice}>
          Fictional demo. Simulated handoff changes resettable demo state only.
          It does not create a provider identity, trial enforcement, or a
          billing effect.
        </p>
      ) : null}
      {!available ? (
        <p role="status">
          The request service is unavailable or your finance authority is
          insufficient.
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {!requests.length ? (
        <p>No customer requests are waiting in this workspace.</p>
      ) : (
        requests.map((request) => (
          <section
            className={styles.panel}
            key={`${request.id}:${request.rowVersion}`}
          >
            <div className={styles.panelHeader}>
              <h2>
                {request.kind.replaceAll("_", " ")} · {request.organizationName}
              </h2>
              <StatusPill state={request.status} />
            </div>
            <div className={styles.panelBody}>
              <p>
                {request.offer.name} v{request.offer.version} ·{" "}
                {request.offer.region}
              </p>
              <p>
                Requested {request.acceptedAt} · Terms version{" "}
                {request.offer.notices.terms.version} · Retention version{" "}
                {request.offer.notices.retention.version}
              </p>
              <dl>
                <dt>{t("nav.account")}</dt>
                <dd>{request.accountId}</dd>
                <dt>{t("nav.group.organization")}</dt>
                <dd>{request.organizationId}</dd>
                <dt>Approved offer</dt>
                <dd>{request.offer.id}</dd>
                <dt>Request</dt>
                <dd>{request.id}</dd>
              </dl>
              <p>{request.offer.notices.serviceNotice}</p>
              {request.reason ? <p>Customer reason: {request.reason}</p> : null}
              {request.resolutionReason ? (
                <p>Resolution: {request.resolutionReason}</p>
              ) : null}
              {request.status === "pending" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const submitter = event.nativeEvent.submitter;
                    const decision =
                      submitter instanceof HTMLButtonElement
                        ? submitter.value
                        : "fulfilled";
                    setPending(request.id);
                    void resolveCustomerAcquisition({
                      id: request.id,
                      expectedRowVersion: request.rowVersion,
                      decision,
                      reason: field(data, "reason"),
                      ...(data.get("trialId")
                        ? { trialId: field(data, "trialId") }
                        : {}),
                      ...(data.get("enrollmentId")
                        ? { enrollmentId: field(data, "enrollmentId") }
                        : {}),
                    })
                      .then((result) => {
                        setMessage(result.message);
                        if (result.ok) router.refresh();
                      })
                      .catch(() =>
                        setMessage(
                          "Resolution did not complete. Refresh to check the current request.",
                        ),
                      )
                      .finally(() => setPending(""));
                  }}
                >
                  <fieldset
                    className={styles.formGrid}
                    disabled={Boolean(pending) || !available}
                  >
                    <legend>
                      {demo
                        ? "Simulate a completed handoff"
                        : "Link verified result"}
                    </legend>
                    {!demo ? (
                      <>
                        {request.kind === "trial" ? (
                          <label className={styles.field}>
                            Verified trial claim ID
                            <input
                              name="trialId"
                              placeholder="Existing trial UUID"
                            />
                          </label>
                        ) : (
                          <label className={styles.field}>
                            Verified PAYG enrollment ID
                            <input
                              name="enrollmentId"
                              defaultValue={request.enrollmentId ?? ""}
                              placeholder="Existing enrollment UUID"
                            />
                          </label>
                        )}
                        <p>
                          Complete the source workflow first. Trial conversion
                          must already reference this paid enrollment;
                          cancellation requires its confirmed service-end
                          evidence. Account, organization, tenant and policy
                          must all match.
                        </p>
                      </>
                    ) : null}
                    <label className={styles.field}>
                      Resolution reason
                      <textarea
                        name="reason"
                        required
                        minLength={8}
                        maxLength={2000}
                      />
                    </label>
                    <div className={styles.actions}>
                      <button
                        className={styles.button}
                        name="decision"
                        value="fulfilled"
                      >
                        {demo
                          ? "Simulate verified handoff"
                          : "Link verified service record"}
                      </button>
                      <button
                        className={styles.buttonSecondary}
                        name="decision"
                        value="declined"
                      >
                        Decline request
                      </button>
                    </div>
                  </fieldset>
                </form>
              ) : null}
            </div>
          </section>
        ))
      )}
    </AdministrationPage>
  );
}
