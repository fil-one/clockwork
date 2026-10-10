import type { Route } from "next";
import Link from "next/link";
import type { ContractType } from "@clockwork/contracts";
import {
  Breadcrumbs,
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonClassName,
} from "@clockwork/ui";
import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { Translator } from "@/src/i18n";
import { contractTypeLabels } from "./copy";
import styles from "./contracts.module.css";

export interface TemplateSummary {
  id: string;
  contractType: ContractType;
  status: "available" | "pending_legal";
  version?: string;
  requiresApproval?: boolean;
}

/**
 * Every agreement Fil One can prepare from approved wording. Templates legal
 * has not supplied are named in one line so the team knows they are coming;
 * until one is ready, the page points to recording a signed agreement.
 */
export function TemplatePicker({
  t,
  templates,
  canWrite,
}: {
  t: Translator;
  templates: readonly TemplateSummary[];
  canWrite: boolean;
}) {
  const ready = templates.filter((template) => template.status === "available");
  const pending = templates
    .filter((template) => template.status !== "available")
    .map((template) => t(contractTypeLabels[template.contractType]));
  const record = canWrite ? (
    <Link className={buttonClassName()} href="/internal/contracts/new">
      {t("operations.contracts.action.record")}
    </Link>
  ) : undefined;
  return (
    <main className={styles.page} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={[
          {
            label: t("operations.contracts.title"),
            href: "/internal/contracts",
          },
          { label: t("operations.contracts.templates.title") },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={t("operations.contracts.templates.title")}
        description={t("operations.contracts.templates.description")}
      />
      {ready.length === 0 ? (
        <EmptyState
          title={t("operations.contracts.templates.noneReadyTitle")}
          description={t("operations.contracts.templates.noneReadyBody", {
            names: pending.join(", "),
          })}
          {...(record ? { action: record } : {})}
        />
      ) : (
        <>
          <ul className={styles.templateGrid}>
            {ready.map((template) => {
              const name = t(contractTypeLabels[template.contractType]);
              return (
                <li key={template.id}>
                  <article
                    className={`${styles.card} ${styles.templateCard}`}
                    aria-labelledby={`template-${template.id}`}
                  >
                    <div className={styles.badges}>
                      <StatusBadge tone="success">
                        {t("operations.contracts.templates.ready")}
                      </StatusBadge>
                    </div>
                    <div>
                      <h2 id={`template-${template.id}`}>{name}</h2>
                      <p className={styles.muted}>
                        {t(
                          template.requiresApproval
                            ? "operations.contracts.templates.readyWithApproval"
                            : "operations.contracts.templates.readyBody",
                          { version: template.version ?? "" },
                        )}
                      </p>
                    </div>
                    {canWrite ? (
                      <div className={styles.formActions}>
                        <Link
                          className={buttonClassName()}
                          href={
                            `/internal/contracts/templates/${template.id}` as Route
                          }
                          aria-label={t(
                            "operations.contracts.templates.prepareNamed",
                            { name },
                          )}
                        >
                          {t("operations.contracts.templates.prepare")}
                        </Link>
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
          {pending.length ? (
            <p className={styles.muted}>
              {t("operations.contracts.templates.pendingList", {
                names: pending.join(", "),
              })}
              {canWrite ? (
                <>
                  {" "}
                  <Link href="/internal/contracts/new">
                    {t("operations.contracts.action.record")}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
