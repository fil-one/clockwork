import type { Route } from "next";
import Link from "next/link";
import type { ContractTemplateStatus } from "@clockwork/contracts";
import {
  Breadcrumbs,
  EmptyState,
  InlineNotice,
  PageHeader,
  StatusBadge,
  Table,
  buttonClassName,
} from "@clockwork/ui";
import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { MessageId, Translator } from "@/src/i18n";
import { contractTypeLabels } from "../contracts/copy";
import type { TemplateGroup } from "./model";
import { versionHref } from "./paths";
import styles from "./templates.module.css";

export const templateStatusLabels: Readonly<
  Record<ContractTemplateStatus, MessageId>
> = {
  draft: "operations.contractTemplates.status.draft",
  active: "operations.contractTemplates.status.active",
  retired: "operations.contractTemplates.status.retired",
};
export const templateStatusTone = {
  draft: "warning",
  active: "success",
  retired: "neutral",
} as const satisfies Record<ContractTemplateStatus, string>;

/** A timestamp as a day in the reader's language. */
export function day(iso: string | null, locale: string) {
  return iso
    ? new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(iso))
    : "";
}

export function TemplateBreadcrumbs({
  t,
  current,
}: {
  t: Translator;
  current?: string;
}) {
  return (
    <Breadcrumbs
      label={breadcrumbsLabel(t)}
      items={[
        { label: t("operations.contracts.title"), href: "/internal/contracts" },
        {
          label: t("operations.contracts.templates.title"),
          href: "/internal/contracts/templates",
        },
        current
          ? {
              label: t("operations.contractTemplates.title"),
              href: "/internal/contracts/manage-templates",
            }
          : { label: t("operations.contractTemplates.title") },
        ...(current ? [{ label: current }] : []),
      ]}
      renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
    />
  );
}

/** Every template, the version in use and its history. */
export function TemplateAdminList({
  t,
  locale,
  groups,
  demo,
}: {
  t: Translator;
  locale: string;
  groups: readonly TemplateGroup[];
  demo: boolean;
}) {
  const create = (
    <Link
      className={buttonClassName()}
      href="/internal/contracts/manage-templates/new"
    >
      {t("operations.contractTemplates.new")}
    </Link>
  );
  return (
    <main className={styles.page} id="main-content">
      <TemplateBreadcrumbs t={t} />
      <PageHeader
        title={t("operations.contractTemplates.title")}
        description={t("operations.contractTemplates.description")}
        actions={create}
      />
      {demo ? (
        <InlineNotice
          tone="info"
          title={t("operations.contractTemplates.demoTitle")}
          description={t("operations.contractTemplates.demoBody")}
        />
      ) : null}
      {groups.length === 0 ? (
        <EmptyState
          title={t("operations.contractTemplates.emptyTitle")}
          description={t("operations.contractTemplates.emptyBody")}
          action={create}
        />
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            className={`${styles.card} ${styles.group}`}
            aria-labelledby={`template-${group.key}`}
          >
            <div className={styles.groupHeader}>
              <h2 id={`template-${group.key}`}>{group.name}</h2>
              <span className={`${styles.muted} ${styles.code}`}>
                {group.key}
              </span>
            </div>
            <p className={styles.muted}>
              {group.active
                ? t("operations.contractTemplates.inUse", {
                    version: group.active.versionLabel,
                    name: group.active.activatedByName ?? "",
                    date: day(group.active.activatedAt, locale),
                  })
                : t("operations.contractTemplates.notInUse")}
            </p>
            <Table
              caption={t("operations.contractTemplates.versions", {
                name: group.name,
              })}
              captionHidden
              density="compact"
              headers={[
                t("operations.contractTemplates.column.version"),
                t("operations.contractTemplates.column.status"),
                t("operations.contractTemplates.column.type"),
                t("operations.contractTemplates.column.source"),
                t("operations.contractTemplates.column.updated"),
              ]}
              rowKeys={group.versions.map((row) => row.id)}
              rows={group.versions.map((row) => [
                <Link key="v" href={versionHref(row.id)}>
                  {t("operations.contractTemplates.openVersion", {
                    version: row.versionLabel,
                  })}
                </Link>,
                <StatusBadge key="s" tone={templateStatusTone[row.status]}>
                  {t(templateStatusLabels[row.status])}
                </StatusBadge>,
                t(contractTypeLabels[row.contractType]),
                row.sourceNote || t("operations.contracts.none"),
                t("operations.contractTemplates.updatedBy", {
                  date: day(row.updatedAt, locale),
                  name:
                    row.status === "draft"
                      ? row.createdByName
                      : (row.activatedByName ?? row.createdByName),
                }),
              ])}
            />
          </section>
        ))
      )}
    </main>
  );
}
