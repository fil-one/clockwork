"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CustomerAcquisitionRequest } from "@clockwork/domain/core";
import { resolveCustomerAcquisition } from "./actions";
import { requestKindLabels } from "./customer";
import {
  AdministrationPage,
  styles,
  StatusPill,
} from "@/src/features/internal-ops/administration-safety/ui";
function field(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
/** When the customer accepted, in UTC and labelled so; the terms are UTC-based. */
function utcTime(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
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
  const formattingLocale = useFormattingLocale();
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  return (
    <AdministrationPage
      eyebrow={t("customer.paygFinance.eyebrow")}
      title={t("customer.paygFinance.title")}
      description={t("customer.paygFinance.description")}
    >
      <p>
        <Link href="/internal/payg-offers">
          {t("customer.paygFinance.managePolicies")}
        </Link>
      </p>
      {demo ? (
        <p className={styles.roleNotice}>
          {t("customer.paygFinance.demoNotice")}
        </p>
      ) : null}
      {!available ? (
        <p role="status">{t("customer.paygFinance.unavailable")}</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {!requests.length ? (
        <p>{t("customer.paygFinance.empty")}</p>
      ) : (
        requests.map((request) => (
          <section
            className={styles.panel}
            key={`${request.id}:${request.rowVersion}`}
          >
            <div className={styles.panelHeader}>
              <h2>
                {t("common.join.labels", {
                  first: t(requestKindLabels[request.kind]),
                  second: request.organizationName,
                })}
              </h2>
              <StatusPill state={request.status} />
            </div>
            <div className={styles.panelBody}>
              <p>
                {t("customer.payg.offerOption", {
                  name: request.offer.name,
                  region: request.offer.region,
                  version: request.offer.version,
                })}
              </p>
              <p>
                {t("customer.paygFinance.requestedTerms", {
                  time: utcTime(request.acceptedAt, formattingLocale),
                  terms: request.offer.notices.terms.version,
                  retention: request.offer.notices.retention.version,
                })}
              </p>
              <dl>
                <dt>{t("nav.account")}</dt>
                <dd>{request.accountId}</dd>
                <dt>{t("nav.group.organization")}</dt>
                <dd>{request.organizationId}</dd>
                <dt>{t("customer.paygFinance.approvedOffer")}</dt>
                <dd>{request.offer.id}</dd>
                <dt>{t("customer.paygFinance.request")}</dt>
                <dd>{request.id}</dd>
              </dl>
              <p dir="auto">{request.offer.notices.serviceNotice}</p>
              {request.reason ? (
                <p>
                  {t("customer.paygFinance.customerReason", {
                    reason: request.reason,
                  })}
                </p>
              ) : null}
              {request.resolutionReason ? (
                <p>
                  {t("customer.paygFinance.resolution", {
                    reason: request.resolutionReason,
                  })}
                </p>
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
                        setMessage(t("customer.paygFinance.didNotComplete")),
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
                        ? t("customer.paygFinance.simulateHandoff")
                        : t("customer.paygFinance.linkResult")}
                    </legend>
                    {!demo ? (
                      <>
                        {request.kind === "trial" ? (
                          <label className={styles.field}>
                            {t("customer.paygFinance.trialClaimId")}
                            <input
                              name="trialId"
                              placeholder={t(
                                "customer.paygFinance.trialClaimPlaceholder",
                              )}
                            />
                          </label>
                        ) : (
                          <label className={styles.field}>
                            {t("customer.paygFinance.enrollmentId")}
                            <input
                              name="enrollmentId"
                              defaultValue={request.enrollmentId ?? ""}
                              placeholder={t(
                                "customer.paygFinance.enrollmentPlaceholder",
                              )}
                            />
                          </label>
                        )}
                        <p>{t("customer.paygFinance.linkRequirements")}</p>
                      </>
                    ) : null}
                    <label className={styles.field}>
                      {t("customer.paygFinance.resolutionReason")}
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
                          ? t("customer.paygFinance.simulateVerifiedHandoff")
                          : t("customer.paygFinance.linkServiceRecord")}
                      </button>
                      <button
                        className={styles.buttonSecondary}
                        name="decision"
                        value="declined"
                      >
                        {t("customer.paygFinance.decline")}
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
