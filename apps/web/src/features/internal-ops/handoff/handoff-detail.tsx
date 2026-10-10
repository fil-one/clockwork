import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type { HandoffRequestDetail } from "@clockwork/db";
import { Breadcrumbs, PageHeader, StatusBadge } from "@clockwork/ui";

import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { Translator } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { contractStatusLabels, formatContractDate } from "../contracts/copy";
import { HandoffDecision } from "./handoff-decision";
import {
  handoffDay,
  handoffSideLabels,
  handoffStatusLabels,
  handoffStatusTone,
} from "./model";
import styles from "./handoff.module.css";

/** A contract's status and how it came to be signed, in one phrase. */
function contractState(
  contract: HandoffRequestDetail["contracts"][number],
  t: Translator,
): string {
  if (contract.status === "executed" && contract.signedVia)
    return t(
      contract.signedVia === "commerce"
        ? "operations.handoff.detail.signedInCommerceOnly"
        : "operations.handoff.detail.recordedExecutedOnly",
    );
  const status = t(contractStatusLabels[contract.status]);
  return contract.signedVia === "commerce"
    ? `${status}, ${t("operations.handoff.detail.signedInCommerce")}`
    : contract.signedVia === "recorded"
      ? `${status}, ${t("operations.handoff.detail.recordedExecuted")}`
      : status;
}

/** One handoff as operations works it. */
export async function HandoffDetailView({
  request,
  canWork,
  readerId,
  children,
}: {
  request: HandoffRequestDetail;
  canWork: boolean;
  readerId: string;
  /** Further steps for this request, such as setting up the organization. */
  children?: ReactNode;
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  const none = t("operations.handoff.detail.none");
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={[
          {
            label: t("operations.handoff.queue.title"),
            href: "/internal/handoffs",
          },
          { label: request.counterpartyLegalName },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={request.counterpartyLegalName}
        description={t("operations.handoff.detail.requested", {
          name: request.requestedByName,
          date: formatContractDate(handoffDay(request.createdAt), locale),
        })}
        metadata={
          <span className={styles.rowHeading}>
            <StatusBadge tone={handoffStatusTone[request.status]}>
              {t(handoffStatusLabels[request.status])}
            </StatusBadge>
            <span>{t(handoffSideLabels[request.requestedSide])}</span>
          </span>
        }
      />
      <section className={styles.card} aria-labelledby="handoff-facts">
        <h2 id="handoff-facts">{t("operations.handoff.detail.title")}</h2>
        <dl className={styles.facts}>
          <dt>{t("operations.handoff.detail.contracts")}</dt>
          <dd>
            <ul className={styles.list}>
              {request.contracts.map((contract) => (
                <li key={contract.id}>
                  <Link href={`/internal/contracts/${contract.id}` as Route}>
                    {contract.title || contract.counterpartyName}
                  </Link>{" "}
                  ({contractState(contract, t)})
                </li>
              ))}
            </ul>
          </dd>
          <dt>{t("operations.handoff.detail.signer")}</dt>
          <dd>
            {[request.signerName, request.signerTitle, request.signerEmail]
              .filter(Boolean)
              .join(", ")}
          </dd>
          <dt>{t("operations.handoff.detail.mnda")}</dt>
          <dd>
            {request.mnda
              ? t("operations.handoff.detail.mndaCompleted", {
                  company: request.mnda.company,
                  signer: request.mnda.signerName,
                })
              : none}
          </dd>
          <dt>{t("operations.handoff.detail.scenario")}</dt>
          <dd>
            {request.pricingScenario ? (
              <Link
                href={
                  `/internal/pricing?scenario=${request.pricingScenario.id}` as Route
                }
              >
                {request.pricingScenario.name} (
                {request.pricingScenario.company})
              </Link>
            ) : request.pricingScenarioId ? (
              t("operations.handoff.detail.scenarioMissing")
            ) : (
              none
            )}
          </dd>
          <dt>{t("operations.handoff.detail.notes")}</dt>
          <dd>{request.notes || none}</dd>
          <dt>{t("operations.handoff.column.assignee")}</dt>
          <dd>{request.assigneeName ?? t("operations.handoff.unassigned")}</dd>
          {request.decisionNote ? (
            <>
              <dt>{t("operations.handoff.detail.decision")}</dt>
              <dd>{request.decisionNote}</dd>
            </>
          ) : null}
        </dl>
      </section>
      {children}
      {canWork ? (
        <HandoffDecision
          id={request.id}
          version={request.version}
          status={request.status}
          assignedToReader={request.assigneeId === readerId}
        />
      ) : null}
    </main>
  );
}
