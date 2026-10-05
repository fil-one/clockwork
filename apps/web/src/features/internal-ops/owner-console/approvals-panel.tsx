"use client";

import type { Route } from "next";
import Link from "next/link";
import { useId } from "react";

import { StatusBadge } from "@clockwork/ui";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { LocalTimestamp } from "../local-timestamp";
import { queueLabels } from "../queue-search/copy";
import {
  approvalControlLabels,
  capabilityLabels,
  type ApprovalItemView,
  type ApprovalsView,
} from "./model";
import styles from "./owner-console.module.css";
import { Panel } from "./panel";
import { SelfApprovalAction } from "./self-approval-action";

/** What a request or a self-approval is about, worded for the reader. */
export function useApprovalSubject(): (
  item: Pick<ApprovalItemView, "control" | "name" | "version" | "detail">,
) => string {
  const t = useTranslations();
  const locale = useFormattingLocale();
  return (item) => {
    const name = item.name ?? t("operations.owner.event.unknownSubject");
    switch (item.control) {
      case "capability_activation": {
        const label = item.name ? capabilityLabels[item.name] : undefined;
        return label ? t(label) : name;
      }
      case "channel_policy":
        return item.detail
          ? t("operations.owner.approvals.subject.policy", {
              version: item.version ?? "",
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeZone: "UTC",
              }).format(new Date(`${item.detail}T00:00:00Z`)),
            })
          : t("operations.owner.approvals.subject.version", {
              version: item.version ?? "",
            });
      case "payg_offer":
        return t("operations.owner.approvals.subject.offer", {
          name,
          region: item.detail ?? "",
          version: item.version ?? "",
        });
      case "exception_case": {
        const queue = item.detail ? queueLabels[item.detail] : undefined;
        return t("operations.owner.approvals.subject.exception", {
          queue: queue ? t(queue) : (item.detail ?? ""),
          name,
        });
      }
      case "price_book_activation":
      case "tax_rule_book_activation":
        return item.version === null
          ? name
          : t("operations.owner.approvals.subject.versioned", {
              name,
              version: item.version,
            });
      case "termination":
        return name;
    }
  };
}

function ApprovalRow({
  item,
  editable,
}: {
  item: ApprovalItemView;
  editable: boolean;
}) {
  const t = useTranslations();
  const subject = useApprovalSubject();
  const subjectId = useId();
  return (
    <li className={styles.item}>
      <div className={styles.itemText}>
        <span className={styles.badges}>
          <StatusBadge tone="neutral">
            {t(approvalControlLabels[item.control])}
          </StatusBadge>
          {item.ownRequest ? (
            <StatusBadge tone="warning">
              {t(
                item.selfApproval
                  ? "operations.owner.approvals.yoursSelf"
                  : "operations.owner.approvals.yours",
              )}
            </StatusBadge>
          ) : null}
        </span>
        <p className={styles.eventText} id={subjectId}>
          <bdi>{subject(item)}</bdi>
        </p>
        <p className={styles.reason}>
          {item.requestedBy
            ? t("operations.owner.approvals.requested", {
                name: item.requestedBy,
              })
            : t("operations.owner.approvals.requestedBySystem")}
        </p>
        <p className={styles.time}>
          <LocalTimestamp value={item.requestedAt} />
        </p>
      </div>
      <div className={styles.rowActions}>
        {item.selfApproval ? (
          <SelfApprovalAction
            item={item}
            target={item.selfApproval}
            subject={subject(item)}
            editable={editable}
          />
        ) : null}
        {item.href ? (
          <Link
            className={styles.panelLink}
            href={item.href as Route}
            aria-describedby={subjectId}
          >
            {t("operations.owner.approvals.open")}
          </Link>
        ) : (
          <span className={styles.muted}>
            {t("operations.owner.approvals.noPage")}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * Everything waiting for a second person, from every control, oldest first.
 * Each request is decided on its own page; a commerce administrator's own
 * request on a control decided in the portal can also be approved here, with
 * a reason. A control that could not be read says so on its own line; the
 * rest of the list stands.
 */
export function ApprovalsPanel({
  approvals,
  editable = true,
}: {
  approvals: ApprovalsView;
  /** False in the demo, which changes nothing. */
  editable?: boolean;
}) {
  const t = useTranslations();
  return (
    <Panel
      id="owner-approvals"
      title={t("operations.owner.approvals.title")}
      description={t("operations.owner.approvals.description")}
      count={approvals.items.length}
    >
      {approvals.unavailable.map((control) => (
        <p key={control} className={styles.unavailable} role="status">
          {t("operations.owner.approvals.unavailable", {
            control: t(approvalControlLabels[control]),
          })}
        </p>
      ))}
      {approvals.items.length > 0 ? (
        <ul className={styles.list}>
          {approvals.items.map((item) => (
            <ApprovalRow
              key={`${item.control}:${item.id}`}
              item={item}
              editable={editable}
            />
          ))}
        </ul>
      ) : approvals.unavailable.length === 0 ? (
        <p className={styles.empty}>{t("operations.owner.approvals.empty")}</p>
      ) : null}
    </Panel>
  );
}
