"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  countHubSpotPlan,
  hubspotImportStatus,
  type HubSpotFieldAction,
  type HubSpotImportItem,
  type HubSpotImportRecord,
} from "@clockwork/contracts";
import {
  Button,
  InlineNotice,
  Input,
  StatusBadge,
  Tag,
  buttonClassName,
} from "@clockwork/ui";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";

import { LocalTimestamp } from "../local-timestamp";
import { partnerEditHref } from "../partners/model";
import {
  excludeHubSpotDocument,
  processHubSpotDocument,
  reuseHubSpotDocument,
} from "./actions";
import {
  formatHubSpotAmount,
  formatHubSpotDate,
  hubspotErrorMessage,
  importStatusLabels,
  importStatusTone,
  itemStatusLabels,
  itemStatusTone,
} from "./model";
import styles from "./hubspot.module.css";

const actionLabels: Readonly<Record<HubSpotFieldAction, MessageId>> = {
  add: "operations.hubspot.receipt.added",
  replace: "operations.hubspot.receipt.replaced",
  clear: "operations.hubspot.receipt.cleared",
  keep: "operations.hubspot.receipt.kept",
};

const fieldLabels: Readonly<Record<string, MessageId>> = {
  name: "operations.partners.field.name",
  website: "operations.partners.field.website",
  region: "operations.partners.field.region",
};

/**
 * What a handoff did, item by item. "Record saved" and "Handoff complete"
 * are separate facts: the partner is usable as soon as it is saved, but the
 * handoff is complete only when every selected document is attached, reused
 * or explicitly excluded, and an exclusion is said out loud.
 */
export function HubSpotReceipt({
  record: initial,
  canEdit,
  autoStart,
  focus,
}: {
  record: HubSpotImportRecord;
  canEdit: boolean;
  /** Bring pending documents across now, right after the commit. */
  autoStart: boolean;
  /** Move focus here: the person just finished the review. */
  focus: boolean;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [record, setRecord] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const [, startTransition] = useTransition();
  const started = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => setRecord(initial), [initial]);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);

  async function act(
    item: HubSpotImportItem,
    run: () => Promise<
      { ok: true; value: HubSpotImportRecord } | { ok: false; code: string }
    >,
  ) {
    setBusy(item.id);
    setFailure(null);
    const result = await run().catch(() => ({
      ok: false as const,
      code: "UNEXPECTED",
    }));
    setBusy(null);
    if (!result.ok) {
      setFailure(result.code);
      return;
    }
    setRecord(result.value);
    const updated = result.value.items.find((i) => i.id === item.id);
    if (updated)
      setAnnouncement(
        t("operations.hubspot.receipt.itemAnnounce", {
          title: updated.title,
          status: t(itemStatusLabels[updated.status]),
        }),
      );
    startTransition(() => router.refresh());
  }

  const process = (item: HubSpotImportItem) =>
    act(item, () =>
      processHubSpotDocument({
        partnerId: record.partnerId,
        importId: record.id,
        itemId: item.id,
      }),
    );

  // Right after the commit, documents come across one at a time so each has
  // its own result; anything that fails waits here for a person.
  useEffect(() => {
    if (!autoStart || !canEdit || started.current) return;
    started.current = true;
    void (async () => {
      for (const item of initial.items)
        if (item.status === "pending" && item.attempts === 0)
          await process(item);
    })();
    // Once, on arrival.
  }, []);

  const status = hubspotImportStatus(record.items);
  const counts = countHubSpotPlan(record.plan);
  const open = record.items.filter((item) =>
    ["pending", "failed", "duplicate"].includes(item.status),
  ).length;
  const excluded = record.items.filter(
    (item) => item.status === "excluded",
  ).length;
  const saved = t(
    record.createdPartner
      ? "operations.hubspot.receipt.partnerCreated"
      : "operations.hubspot.receipt.recordSaved",
  );
  const state =
    status === "needs_attention"
      ? t("operations.hubspot.receipt.needsAttention", { count: open })
      : status === "completed_with_exclusions"
        ? t("operations.hubspot.receipt.withExclusions", { count: excluded })
        : t("operations.hubspot.receipt.complete");
  const deal = record.plan.deal;
  const changedFields = record.plan.fields.filter(
    (field) => field.action !== "keep",
  );

  return (
    <section
      className={styles.card}
      aria-labelledby="hubspot-receipt-heading"
      id="hubspot-receipt"
    >
      <div className={styles.cardHeading}>
        <h2
          id="hubspot-receipt-heading"
          ref={heading}
          tabIndex={-1}
          className={styles.receipt}
        >
          {t("operations.hubspot.receipt.title")}
        </h2>
        <StatusBadge tone={importStatusTone[status]}>
          {t(importStatusLabels[status])}
        </StatusBadge>
      </div>
      <p className={styles.summary}>
        {saved} · {state}
      </p>
      <p className="cw-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {status === "needs_attention" ? (
        <p className={styles.muted}>{t("operations.hubspot.receipt.usable")}</p>
      ) : null}
      {failure ? (
        <InlineNotice
          tone="danger"
          live="assertive"
          title={t(hubspotErrorMessage(failure))}
        />
      ) : null}

      <dl className={styles.facts}>
        <dt>{t("operations.hubspot.receipt.source")}</dt>
        <dd>
          <a
            href={record.snapshot.company.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {record.snapshot.company.name}
          </a>
          {deal ? (
            <>
              {" · "}
              <a href={deal.url} target="_blank" rel="noreferrer noopener">
                {deal.name}
              </a>
            </>
          ) : null}
        </dd>
        <dt>{t("operations.hubspot.receipt.by")}</dt>
        <dd>
          {record.createdByName} ·{" "}
          <LocalTimestamp value={record.createdAt} locale={locale} />
        </dd>
        <dt>{t("operations.hubspot.receipt.copied")}</dt>
        <dd>
          {changedFields.length ||
          counts.contactsAdded ||
          counts.contactsLinked ? (
            <ul className={styles.list}>
              {changedFields.map((field) => (
                <li key={field.field}>
                  <span>
                    {t(actionLabels[field.action], {
                      field: t(
                        fieldLabels[field.field] ??
                          "operations.partners.field.name",
                      ),
                      value: field.result,
                    })}
                  </span>
                  {field.result !== field.hubspot && field.hubspot ? (
                    <span className={styles.source}>
                      {t("operations.hubspot.inHubSpot", {
                        value: field.hubspot,
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
              {record.plan.contacts.map((contact) => (
                <li key={contact.hubspotId}>
                  <span>
                    {t(
                      contact.matchedExisting
                        ? "operations.hubspot.receipt.contactLinked"
                        : "operations.hubspot.receipt.contactAdded",
                      { name: contact.name },
                    )}
                    {record.plan.primaryContactId === contact.id
                      ? ` · ${t("operations.hubspot.receipt.primary")}`
                      : ""}
                  </span>
                  {contact.labels.length ? (
                    <span className={styles.tags}>
                      {contact.labels.map((label) => (
                        <Tag key={label}>{label}</Tag>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            t("operations.hubspot.receipt.nothingCopied")
          )}
        </dd>
        <dt>{t("operations.hubspot.receipt.reference")}</dt>
        <dd>
          {deal || record.plan.notes.length || record.plan.references.length ? (
            <ul className={styles.list}>
              {deal ? (
                <li>
                  <span>
                    {t("operations.hubspot.receipt.deal", {
                      name: deal.name,
                      stage: deal.stage.label ?? t("operations.hubspot.notSet"),
                    })}
                  </span>
                  <span className={styles.secondary}>
                    {[
                      deal.amount && deal.currency
                        ? formatHubSpotAmount(
                            deal.amount,
                            deal.currency,
                            locale,
                          )
                        : t("operations.hubspot.receipt.amountNotSet"),
                      formatHubSpotDate(deal.closeDate, locale)
                        ? t("operations.hubspot.receipt.closes", {
                            date:
                              formatHubSpotDate(deal.closeDate, locale) ?? "",
                          })
                        : null,
                      deal.endCustomer
                        ? t("operations.hubspot.receipt.endCustomer", {
                            name: deal.endCustomer.name,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ) : null}
              {record.plan.notes.map((note) => (
                <li key={note.id}>
                  <details>
                    <summary>
                      {t("operations.hubspot.notes.label", {
                        author:
                          note.authorName ??
                          t("operations.hubspot.notes.unknownAuthor"),
                        date:
                          formatHubSpotDate(note.timestamp, locale) ??
                          t("operations.hubspot.notSet"),
                      })}
                    </summary>
                    <p className={`${styles.prose} ${styles.secondary}`}>
                      {note.body}
                    </p>
                  </details>
                </li>
              ))}
              {record.plan.references.map((value) => (
                <li key={`${value.objectType}:${value.property}`}>
                  <span>
                    {value.label}:{" "}
                    {value.value ?? t("operations.hubspot.notSet")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            t("operations.hubspot.receipt.nothingKept")
          )}
        </dd>
        <dt>{t("operations.hubspot.receipt.leftOut")}</dt>
        <dd>
          {[
            record.plan.omitted.contacts
              ? t("operations.hubspot.summary.contacts", {
                  count: record.plan.omitted.contacts,
                })
              : "",
            record.plan.omitted.notes
              ? t("operations.hubspot.summary.notes", {
                  count: record.plan.omitted.notes,
                })
              : "",
            record.plan.omitted.documents
              ? t("operations.hubspot.summary.documents", {
                  count: record.plan.omitted.documents,
                })
              : "",
            record.plan.omitted.properties
              ? t("operations.hubspot.summary.references", {
                  count: record.plan.omitted.properties,
                })
              : "",
          ]
            .filter(Boolean)
            .join(", ") || t("operations.hubspot.receipt.nothingLeftOut")}
        </dd>
      </dl>

      {record.items.length ? (
        <div className={styles.card}>
          <h3>{t("operations.hubspot.group.documents")}</h3>
          <ul className={styles.list}>
            {record.items.map((item) => (
              <li key={item.id}>
                <div className={styles.rowHeading}>
                  <strong>{item.title}</strong>
                  <StatusBadge tone={itemStatusTone[item.status]}>
                    {t(itemStatusLabels[item.status])}
                  </StatusBadge>
                </div>
                <span className={styles.secondary}>{item.fileName}</span>
                {item.status === "failed" && item.errorCode ? (
                  <span className={styles.secondary}>
                    {t(hubspotErrorMessage(item.errorCode))}
                  </span>
                ) : null}
                {item.status === "duplicate" && item.existingAttachment ? (
                  <span className={styles.secondary}>
                    {t("operations.hubspot.receipt.duplicate", {
                      title: item.existingAttachment.title,
                    })}
                  </span>
                ) : null}
                {item.status === "duplicate" && !item.existingAttachment ? (
                  <span className={styles.secondary}>
                    {t("operations.hubspot.receipt.duplicateRemoved")}
                  </span>
                ) : null}
                {item.attachmentRemoved ? (
                  <span className={styles.secondary}>
                    {t("operations.hubspot.receipt.attachmentRemoved")}
                  </span>
                ) : null}
                {item.status === "excluded" && item.excludedReason ? (
                  <span className={styles.secondary}>
                    {t("operations.hubspot.receipt.excludedBecause", {
                      reason: item.excludedReason,
                    })}
                  </span>
                ) : null}
                {canEdit &&
                ["pending", "failed", "duplicate"].includes(item.status) ? (
                  excluding?.id === item.id ? (
                    <div className={styles.fields}>
                      <Input
                        label={t("operations.hubspot.receipt.excludeReason")}
                        value={excluding.reason}
                        maxLength={500}
                        onChange={(event) =>
                          setExcluding({
                            id: item.id,
                            reason: event.currentTarget.value,
                          })
                        }
                      />
                      <div className={styles.actions}>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={
                            !excluding.reason.trim() || busy === item.id
                          }
                          onClick={() => {
                            const reason = excluding.reason;
                            setExcluding(null);
                            void act(item, () =>
                              excludeHubSpotDocument({
                                partnerId: record.partnerId,
                                importId: record.id,
                                itemId: item.id,
                                reason,
                              }),
                            );
                          }}
                        >
                          {t("operations.hubspot.receipt.excludeConfirm")}
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          onClick={() => setExcluding(null)}
                        >
                          {t("operations.hubspot.cancel.keep")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.actions}>
                      {item.status === "duplicate" &&
                      item.existingAttachment ? (
                        <Button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void act(item, () =>
                              reuseHubSpotDocument({
                                partnerId: record.partnerId,
                                importId: record.id,
                                itemId: item.id,
                              }),
                            )
                          }
                        >
                          {t("operations.hubspot.receipt.useExisting", {
                            title: item.existingAttachment?.title ?? "",
                          })}
                        </Button>
                      ) : item.errorCode ===
                        "HUBSPOT_DOCUMENT_CHANGED" ? null : (
                        <Button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void process(item)}
                        >
                          {busy === item.id
                            ? t("operations.hubspot.receipt.attaching")
                            : (item.status === "pending" &&
                                  item.attempts === 0) ||
                                item.status === "duplicate"
                              ? t("operations.hubspot.receipt.attach")
                              : t("operations.hubspot.receipt.retry")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="quiet"
                        disabled={busy !== null}
                        onClick={() =>
                          setExcluding({ id: item.id, reason: "" })
                        }
                      >
                        {t("operations.hubspot.receipt.exclude")}
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
          <p className={styles.secondary}>
            {t("operations.hubspot.receipt.appendOnly")}
          </p>
        </div>
      ) : null}

      <div className={styles.card}>
        <h3>{t("operations.hubspot.continue.title")}</h3>
        <p className={styles.muted}>{t("operations.hubspot.continue.body")}</p>
        <div className={styles.actions}>
          {canEdit ? (
            <Link
              className={buttonClassName()}
              href={partnerEditHref(record.partnerId)}
            >
              {t("operations.hubspot.continue.relationship")}
            </Link>
          ) : null}
          {canEdit && deal ? (
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={
                `/internal/partners/${record.partnerId}?register=${record.id}#partner-deals` as Route
              }
            >
              {t("operations.hubspot.continue.register")}
            </Link>
          ) : null}
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href={
              `/internal/mndas?compose=1&handoff=${record.id}&partner=${record.partnerId}` as Route
            }
          >
            {t("operations.hubspot.continue.mnda")}
          </Link>
          {record.items.some(
            (item) => item.status === "attached" || item.status === "reused",
          ) ? (
            <a
              className={buttonClassName({ variant: "quiet" })}
              href="#documents"
            >
              {t("operations.hubspot.continue.documents")}
            </a>
          ) : null}
          <a
            className={buttonClassName({ variant: "quiet" })}
            href={deal?.url ?? record.snapshot.company.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("operations.hubspot.continue.source")}
          </a>
        </div>
        {deal ? (
          <p className={styles.secondary}>
            {t("operations.hubspot.continue.registrationNotCreated")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
