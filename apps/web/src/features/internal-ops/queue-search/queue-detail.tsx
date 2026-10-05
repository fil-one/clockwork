"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";

import type { Route } from "next";
import Link from "next/link";

import type { Permission } from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

import { CopyableId } from "../copyable-id";
import { LocalTimestamp } from "../local-timestamp";
import styles from "./queue-search.module.css";
import {
  actionLabels,
  codeLabel,
  queueLabels,
  riskLabels,
  slaChipLabels,
  statusLabels,
  subjectLabels,
} from "./copy";
import {
  permittedActions,
  slaFor,
  type QueueDecisionPermission,
  type QueueItem,
} from "./model";

/** The role that carries a restricted action's authority, as the role list names it. */
const requiredRoleLabels: Readonly<Record<QueueDecisionPermission, MessageId>> =
  {
    "agreement:approve": "role.legalApprover",
    "quote:approve": "role.financeApprover",
    "destructive:approve": "role.destructiveActionApprover",
  };

function Moment({ value }: { value: string | null }) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  if (!value) return <>{t("common.notRecorded")}</>;
  return <LocalTimestamp value={value} locale={formattingLocale} />;
}

export function QueueDetail({
  item,
  permissions = [],
  standalone = false,
  now,
}: {
  item: QueueItem;
  permissions?: readonly Permission[];
  standalone?: boolean;
  now?: Date;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const actions = permittedActions(item, permissions);
  const restricted = actions.length !== item.permittedActions.length;
  const sla = slaFor(item, now);
  return (
    <article
      className={standalone ? styles.detailStandalone : styles.detail}
      aria-labelledby={`detail-title-${item.id}`}
    >
      <header className={styles.detailHeader}>
        <div>
          {item.type ? (
            <p className={styles.eyebrow}>
              {t("operations.queue.detail.queue", {
                queue: codeLabel(queueLabels, item.type, t),
              })}
            </p>
          ) : null}
          <h2 id={`detail-title-${item.id}`}>{item.title}</h2>
          {item.entity ? (
            <p className={styles.entity}>
              {codeLabel(subjectLabels, item.entity, t)}
            </p>
          ) : null}
          <CopyableId value={item.id} label={t("common.referenceLabel")} />
        </div>
        {sla ? (
          <span className={`${styles.sla} ${styles[`sla_${sla}`]}`}>
            {t(slaChipLabels[sla])}
          </span>
        ) : null}
      </header>

      {item.summary ? (
        <p className={styles.detailSummary}>{item.summary}</p>
      ) : null}

      {/*
        Whether an item is owned and what state it is in drives the operator's
        next move, so those rows appear even when the value is absent. A backup,
        a risk band, and a deadline are not carried by every queue type; those
        rows appear only once there is something to read.
      */}
      <dl className={styles.detailFacts}>
        <div>
          <dt>{t("common.owner")}</dt>
          <dd>{item.owner ?? t("common.notRecorded")}</dd>
        </div>
        {item.backup ? (
          <div>
            <dt>{t("operations.queue.filter.backup")}</dt>
            <dd>{item.backup}</dd>
          </div>
        ) : null}
        {item.risk ? (
          <div>
            <dt>{t("common.risk")}</dt>
            <dd>
              <span className={`${styles.risk} ${styles[`risk_${item.risk}`]}`}>
                {t(riskLabels[item.risk])}
              </span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t("common.status")}</dt>
          <dd>
            {item.statusLabel ??
              (item.status
                ? t(statusLabels[item.status])
                : t("common.notRecorded"))}
          </dd>
        </div>
        {item.createdAt ? (
          <div>
            <dt>{t("operations.queue.detail.created")}</dt>
            <dd>
              <Moment value={item.createdAt} />
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t("operations.queue.detail.updated")}</dt>
          <dd>
            <Moment value={item.updatedAt} />
          </dd>
        </div>
        {item.dueAt ? (
          <div>
            <dt>{t("operations.queue.detail.deadline")}</dt>
            <dd>
              <Moment value={item.dueAt} />
            </dd>
          </div>
        ) : null}
      </dl>

      {item.policyReason || item.policyBasis ? (
        <section
          className={styles.detailSection}
          aria-labelledby={`policy-${item.id}`}
        >
          <h3 id={`policy-${item.id}`}>
            {t("operations.queue.detail.reason")}
          </h3>
          {item.policyReason ? <p>{item.policyReason}</p> : null}
          {item.policyBasis ? (
            <p className={styles.policyBasis}>
              <strong>{t("operations.queue.detail.policyBasis")}</strong>{" "}
              {item.policyBasis}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className={styles.detailSection}
        aria-labelledby={`evidence-${item.id}`}
      >
        <h3 id={`evidence-${item.id}`}>
          {t("operations.queue.detail.evidence")}
        </h3>
        <dl className={styles.evidenceList}>
          {item.evidence.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>
                {entry.value}
                {entry.technicalId ? (
                  <details className={styles.technicalDisclosure}>
                    <summary>
                      {t("operations.queue.detail.technicalId")}
                    </summary>
                    <code>{entry.technicalId}</code>
                  </details>
                ) : null}
              </dd>
            </div>
          ))}
          {item.sourceRecord ? (
            <div>
              <dt>{t("operations.queue.detail.sourceRecord")}</dt>
              <dd>
                {richText(t, "operations.queue.detail.sourceVersion", {
                  version: item.sourceRecord.version,
                  time: (
                    <LocalTimestamp
                      value={item.sourceRecord.updatedAt}
                      locale={formattingLocale}
                    />
                  ),
                })}
                <details className={styles.technicalDisclosure}>
                  <summary>{t("operations.queue.detail.technicalId")}</summary>
                  <code>{item.sourceRecord.technicalId}</code>
                </details>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {item.related.length ? (
        <section
          className={styles.detailSection}
          aria-labelledby={`related-${item.id}`}
        >
          <h3 id={`related-${item.id}`}>
            {t("operations.queue.detail.related")}
          </h3>
          <ul className={styles.linkList}>
            {item.related.map((record) => (
              <li key={record.label}>
                <Link href={record.href as Route}>{record.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className={styles.detailSection}
        aria-labelledby={`actions-${item.id}`}
      >
        <h3 id={`actions-${item.id}`}>
          {t("operations.queue.detail.actions")}
        </h3>
        {restricted && item.requiredPermission ? (
          <p className={styles.permissionNote} role="note">
            {t("operations.queue.detail.restricted", {
              role: t(requiredRoleLabels[item.requiredPermission]),
            })}
          </p>
        ) : null}
        <div className={styles.actionHandoff} role="note">
          <strong>{t("operations.queue.detail.reviewOnly")}</strong>
          <p>{t("operations.queue.detail.reviewOnly.body")}</p>
          {actions.length ? (
            <ul>
              {actions.map((action) => (
                <li key={action}>{codeLabel(actionLabels, action, t)}</li>
              ))}
            </ul>
          ) : (
            <p>{t("operations.queue.detail.noActions")}</p>
          )}
        </div>
      </section>
    </article>
  );
}
