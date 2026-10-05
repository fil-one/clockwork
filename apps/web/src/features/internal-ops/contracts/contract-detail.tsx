import type { Route } from "next";
import Link from "next/link";
import {
  contractStatuses,
  contractTypes,
  type ContractActivity,
  type ContractFileRecord,
  type ContractRecord,
  type ContractSigningRecord,
  type UploadableContractFileKind,
} from "@clockwork/contracts";
import {
  DescriptionList,
  InlineNotice,
  PageHeader,
  StatusBadge,
  buttonClassName,
} from "@clockwork/ui";
import type { MessageId, Translator } from "@/src/i18n";
import { formatOperationalTimestamp } from "../presentation";
import { DateValue, DeadlineValue, Tags } from "./cells";
import { ContractDocuments } from "./contract-documents";
import {
  contractFileKindLabels,
  contractPaperLabels,
  contractStatusLabels,
  contractStatusTone,
  contractTypeLabels,
  formatContractDate,
  formatContractValue,
  signingStateLabels,
} from "./copy";
import { SigningPanel } from "./signing-panel";
import styles from "./contracts.module.css";

const changeLabels: Readonly<Record<string, MessageId>> = {
  counterpartyName: "operations.contracts.field.counterparty",
  title: "operations.contracts.field.title",
  contractType: "operations.contracts.field.type",
  paper: "operations.contracts.field.paper",
  status: "operations.contracts.field.status",
  effectiveDate: "operations.contracts.field.effectiveDate",
  initialTermMonths: "operations.contracts.field.initialTerm",
  autoRenew: "operations.contracts.field.autoRenew",
  renewalTermMonths: "operations.contracts.field.renewalTerm",
  noticePeriodDays: "operations.contracts.field.noticePeriod",
  valueMinor: "operations.contracts.field.value",
  currency: "operations.contracts.field.currency",
  pricingNotes: "operations.contracts.field.pricingNotes",
  ownerName: "operations.contracts.field.owner",
  internalNotes: "operations.contracts.field.internalNotes",
  tags: "operations.contracts.field.tags",
};

function changeValue(
  field: string,
  value: unknown,
  t: Translator,
  locale: string,
): string {
  if (value === null || value === undefined || value === "")
    return t("operations.contracts.notSet");
  if (
    field === "status" &&
    (contractStatuses as readonly unknown[]).includes(value)
  )
    return t(contractStatusLabels[value as ContractRecord["status"]]);
  if (
    field === "contractType" &&
    (contractTypes as readonly unknown[]).includes(value)
  )
    return t(contractTypeLabels[value as ContractRecord["contractType"]]);
  if (field === "paper" && (value === "ours" || value === "theirs"))
    return t(contractPaperLabels[value]);
  if (field === "effectiveDate" && typeof value === "string")
    return formatContractDate(value, locale);
  if (typeof value === "boolean")
    return t(value ? "operations.contracts.yes" : "operations.contracts.no");
  if (field === "valueMinor" && typeof value === "number")
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(
      value / 100,
    );
  if (Array.isArray(value)) return value.join(", ");
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function activityTitle(event: ContractActivity, t: Translator) {
  const changes = event.changes as Record<string, unknown>;
  switch (event.eventType) {
    case "contract.created":
      return t("operations.contracts.activity.created");
    case "contract.updated":
      return t("operations.contracts.activity.updated");
    case "contract.document_added":
      return t("operations.contracts.activity.documentAdded", {
        name: typeof changes.fileName === "string" ? changes.fileName : "",
      });
    case "contract.document_removed":
      return t("operations.contracts.activity.documentRemoved", {
        name: typeof changes.fileName === "string" ? changes.fileName : "",
      });
    case "contract.prepared":
      return t("operations.contracts.activity.prepared");
    case "contract.approved":
      return t("operations.contracts.activity.approved");
    case "contract.rejected":
      return t("operations.contracts.activity.rejected");
    default: {
      const state = event.eventType.replace("contract.signing_", "");
      return state in signingStateLabels
        ? t("operations.contracts.activity.signing", {
            state: t(
              signingStateLabels[state as keyof typeof signingStateLabels],
            ),
          })
        : event.eventType;
    }
  }
}

function Activity({
  activity,
  t,
  locale,
}: {
  activity: readonly ContractActivity[];
  t: Translator;
  locale: string;
}) {
  return (
    <section className={styles.card} aria-labelledby="contract-activity">
      <div className={styles.cardHeader}>
        <h2 id="contract-activity">
          {t("operations.contracts.activity.title")}
        </h2>
      </div>
      <ol className={styles.timeline}>
        {activity.map((event) => {
          const changes = event.changes as Record<string, unknown>;
          const diffs =
            event.eventType === "contract.updated"
              ? Object.entries(
                  changes as Record<string, { from: unknown; to: unknown }>,
                )
              : [];
          return (
            <li className={styles.timelineItem} key={event.id}>
              <strong>{activityTitle(event, t)}</strong>
              <span>
                {event.actorName} ·{" "}
                <time dateTime={event.occurredAt}>
                  {formatOperationalTimestamp(event.occurredAt, locale)}
                </time>
              </span>
              {event.eventType === "contract.rejected" &&
              typeof changes.reason === "string" ? (
                <span>{changes.reason}</span>
              ) : null}
              {diffs.length ? (
                <ul className={styles.changeList}>
                  {diffs.map(([field, change]) => (
                    <li key={field}>
                      {t("operations.contracts.activity.change", {
                        field: changeLabels[field]
                          ? t(changeLabels[field])
                          : field,
                        from: changeValue(field, change.from, t, locale),
                        to: changeValue(field, change.to, t, locale),
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function suggestedKind(contract: ContractRecord): UploadableContractFileKind {
  if (contract.status === "executed") return "main";
  return contract.paper === "theirs" ? "counterparty_draft" : "main";
}

export function ContractDetail({
  t,
  locale,
  contract,
  files,
  activity,
  signing,
  today,
  canWrite,
  canApprove,
  isPreparer,
  signingReady,
}: {
  t: Translator;
  locale: string;
  contract: ContractRecord;
  files: readonly ContractFileRecord[];
  activity: readonly ContractActivity[];
  signing: ContractSigningRecord | null;
  today: string;
  canWrite: boolean;
  canApprove: boolean;
  isPreparer: boolean;
  signingReady: boolean;
}) {
  const months = (value: number | null) =>
    value === null
      ? t("operations.contracts.notSet")
      : t("operations.contracts.months", { count: value });
  const signedCopies = files.filter(
    (file) => file.kind === "main" || file.kind === "executed",
  );
  const termEnded =
    contract.termEndDate !== null &&
    contract.termEndDate < today &&
    !contract.autoRenew &&
    contract.status === "executed";
  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        eyebrow={t(contractTypeLabels[contract.contractType])}
        title={contract.counterpartyName}
        description={contract.title || undefined}
        metadata={
          <span className={styles.badges}>
            <StatusBadge tone={contractStatusTone[contract.status]}>
              {t(contractStatusLabels[contract.status])}
            </StatusBadge>
            <StatusBadge>{t(contractPaperLabels[contract.paper])}</StatusBadge>
            <Tags tags={contract.tags} />
          </span>
        }
        actions={
          <div className={styles.headerActions}>
            {canWrite ? (
              <Link
                className={buttonClassName()}
                href={`/internal/contracts/${contract.id}/edit` as Route}
              >
                {t("operations.contracts.action.edit")}
              </Link>
            ) : null}
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/internal/contracts"
            >
              {t("operations.contracts.backToRegister")}
            </Link>
          </div>
        }
      />
      {contract.status === "executed" && signedCopies.length === 0 ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.detail.noSignedCopyTitle")}
          description={t("operations.contracts.detail.noSignedCopyBody")}
        />
      ) : null}
      {termEnded ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.detail.termEndedTitle")}
          description={t("operations.contracts.detail.termEndedBody")}
        />
      ) : null}
      <div className={styles.detailGrid}>
        <div className={styles.stack}>
          {signing ? (
            <SigningPanel
              signing={signing}
              generatedFileId={
                files.find((file) => file.kind === "generated")?.id ?? null
              }
              canWrite={canWrite}
              canApprove={canApprove}
              isPreparer={isPreparer}
              signingReady={signingReady}
            />
          ) : null}
          <section className={styles.card} aria-labelledby="contract-terms">
            <div className={styles.cardHeader}>
              <h2 id="contract-terms">
                {t("operations.contracts.detail.terms")}
              </h2>
            </div>
            <DescriptionList
              columns={2}
              items={[
                {
                  term: t("operations.contracts.field.effectiveDate"),
                  detail: (
                    <DateValue
                      date={contract.effectiveDate}
                      t={t}
                      locale={locale}
                    />
                  ),
                },
                {
                  term: t("operations.contracts.field.initialTerm"),
                  detail: months(contract.initialTermMonths),
                },
                {
                  term: t("operations.contracts.field.autoRenew"),
                  detail: contract.autoRenew
                    ? t("operations.contracts.detail.renewsEvery", {
                        count: contract.renewalTermMonths ?? 0,
                      })
                    : t("operations.contracts.no"),
                },
                {
                  term: t("operations.contracts.field.noticePeriod"),
                  detail:
                    contract.noticePeriodDays === null
                      ? t("operations.contracts.notSet")
                      : t("operations.contracts.days", {
                          count: contract.noticePeriodDays,
                        }),
                },
                {
                  term: t("operations.contracts.field.termEnds"),
                  detail: (
                    <DateValue
                      date={contract.termEndDate}
                      t={t}
                      locale={locale}
                    />
                  ),
                },
                {
                  term: t("operations.contracts.field.renewsOn"),
                  detail: (
                    <DateValue
                      date={contract.renewalDate}
                      t={t}
                      locale={locale}
                    />
                  ),
                },
                {
                  term: t("operations.contracts.field.noticeDeadline"),
                  detail: (
                    <DeadlineValue
                      date={contract.noticeDeadline}
                      today={today}
                      t={t}
                      locale={locale}
                    />
                  ),
                },
                {
                  term: t("operations.contracts.field.value"),
                  detail:
                    contract.valueMinor !== null && contract.currency
                      ? formatContractValue(
                          contract.valueMinor,
                          contract.currency,
                          locale,
                        )
                      : t("operations.contracts.notSet"),
                },
              ]}
            />
            {contract.pricingNotes ? (
              <>
                <h3 className={`${styles.sectionTitle} ${styles.spaced}`}>
                  {t("operations.contracts.field.pricingNotes")}
                </h3>
                <p className={styles.notes}>{contract.pricingNotes}</p>
              </>
            ) : null}
          </section>
          <ContractDocuments
            contractId={contract.id}
            files={files}
            canWrite={canWrite}
            locked={contract.status === "executed"}
            suggestedKind={suggestedKind(contract)}
          />
        </div>
        <div className={styles.stack}>
          <section className={styles.card} aria-labelledby="contract-ownership">
            <div className={styles.cardHeader}>
              <h2 id="contract-ownership">
                {t("operations.contracts.form.ownership")}
              </h2>
            </div>
            <DescriptionList
              columns={1}
              items={[
                {
                  term: t("operations.contracts.field.owner"),
                  detail: contract.ownerName,
                },
                {
                  term: t("operations.contracts.detail.recordedBy"),
                  detail: `${contract.createdByName}, ${formatOperationalTimestamp(contract.createdAt, locale)}`,
                },
                {
                  term: t("operations.contracts.detail.documents"),
                  detail: files.length
                    ? [
                        ...new Set(
                          files.map((f) => t(contractFileKindLabels[f.kind])),
                        ),
                      ].join(", ")
                    : t("operations.contracts.notSet"),
                },
              ]}
            />
            <h3 className={`${styles.sectionTitle} ${styles.spaced}`}>
              {t("operations.contracts.field.internalNotes")}
            </h3>
            <p className={contract.internalNotes ? styles.notes : styles.muted}>
              {contract.internalNotes ||
                t("operations.contracts.detail.noNotes")}
            </p>
          </section>
          <Activity activity={activity} t={t} locale={locale} />
        </div>
      </div>
    </main>
  );
}
