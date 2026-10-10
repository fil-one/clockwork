import type { Route } from "next";
import Link from "next/link";

import type { HandoffRequestRecord } from "@clockwork/contracts";
import type { HandoffContractContext } from "@clockwork/db";
import { StateBanner, StatusBadge } from "@clockwork/ui";

import type { Translator } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import { formatContractDate } from "../contracts/copy";
import { HandoffRequestForm } from "./handoff-request-form";
import {
  handoffDay,
  handoffSideLabels,
  handoffStatusLabels,
  handoffStatusTone,
} from "./model";
import { loadContractHandoff, type Loaded } from "./server";
import styles from "./handoff.module.css";

/** One request as the seller sees it: status, who has it, the decision. */
export function HandoffRequestLine({
  request,
  t,
  locale,
  href,
}: {
  request: HandoffRequestRecord;
  t: Translator;
  locale: string;
  /** Where the counterparty name links, when the reader is elsewhere. */
  href?: string;
}) {
  return (
    <li>
      <span className={styles.rowHeading}>
        <StatusBadge tone={handoffStatusTone[request.status]}>
          {t(handoffStatusLabels[request.status])}
        </StatusBadge>
        <strong>
          {href ? (
            <Link href={href as Route}>{request.counterpartyLegalName}</Link>
          ) : (
            request.counterpartyLegalName
          )}
        </strong>
        <span>{t(handoffSideLabels[request.requestedSide])}</span>
        <span className={styles.muted}>
          {formatContractDate(handoffDay(request.createdAt), locale)}
        </span>
      </span>
      <span className={styles.muted}>
        {t("operations.handoff.column.assignee")}:{" "}
        {request.assigneeName ?? t("operations.handoff.unassigned")}
      </span>
      {request.decisionNote ? (
        <span>
          {t("operations.handoff.detail.decision")}: {request.decisionNote}
        </span>
      ) : null}
    </li>
  );
}

/** The handoff section on a contract record, with what it loaded. */
export async function ContractHandoffSection({
  loaded,
}: {
  loaded: Loaded<HandoffContractContext>;
}) {
  // The demo keeps no handoffs, and its contracts are read-only anyway.
  if (loaded.kind === "forbidden" || loaded.kind === "demo") return null;
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  const context = loaded.kind === "ready" ? loaded.value : null;
  const live = context?.requests.some(
    (request) => request.status !== "declined",
  );
  return (
    <section className={styles.card} aria-labelledby="contract-handoff">
      <div>
        <h2 id="contract-handoff">{t("operations.handoff.panel.title")}</h2>
        <p className={styles.muted}>
          {t("operations.handoff.panel.description")}
        </p>
      </div>
      {!context ? (
        <StateBanner
          tone="warning"
          title={t("operations.handoff.panel.unavailable")}
        />
      ) : (
        <>
          {context.requests.length > 0 ? (
            <ul
              className={styles.list}
              aria-label={t("operations.handoff.panel.requests")}
            >
              {context.requests.map((request) => (
                <HandoffRequestLine
                  key={request.id}
                  request={request}
                  t={t}
                  locale={locale}
                />
              ))}
            </ul>
          ) : null}
          {!context.contract.signed ? (
            <p className={styles.muted}>
              {t("operations.handoff.panel.notSigned")}
            </p>
          ) : live ? null : (
            <HandoffRequestForm
              contractId={context.contract.id}
              legalName={context.contract.counterpartyName}
              signer={context.signer}
              mndas={context.mndas.map((mnda) => ({
                id: mnda.id,
                label: t("operations.handoff.detail.mndaCompleted", {
                  company: mnda.company,
                  signer: mnda.signerName,
                }),
              }))}
              scenarios={context.scenarios.map((scenario) => ({
                id: scenario.id,
                label: `${scenario.name} (${scenario.company})`,
              }))}
            />
          )}
        </>
      )}
    </section>
  );
}

/** Loads and renders the section for one contract. */
export async function ContractHandoff({ contractId }: { contractId: string }) {
  return (
    <ContractHandoffSection loaded={await loadContractHandoff(contractId)} />
  );
}
