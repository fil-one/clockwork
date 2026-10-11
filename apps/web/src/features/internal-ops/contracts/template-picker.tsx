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
  name: string;
  contractType: ContractType;
  version: string;
  requiresApproval: boolean;
  /** How many optional sections the seller may include. */
  sections: number;
}

/**
 * The templates in use, one card each. Commerce administrators also get the
 * way to the template store; everyone else is pointed to recording a signed
 * agreement while a template they need is not in use.
 */
export function TemplatePicker({
  t,
  templates,
  canOpen,
  canWrite,
  canManage,
}: {
  t: Translator;
  templates: readonly TemplateSummary[];
  /** Whether a form opens: to prepare, or in the demo to preview. */
  canOpen: boolean;
  canWrite: boolean;
  canManage: boolean;
}) {
  const record = canWrite ? (
    <Link
      className={buttonClassName({ variant: "secondary" })}
      href="/internal/contracts/new"
    >
      {t("operations.contracts.action.record")}
    </Link>
  ) : undefined;
  const manage = canManage ? (
    <Link
      className={buttonClassName({ variant: "secondary" })}
      href="/internal/contracts/manage-templates"
    >
      {t("operations.contractTemplates.manage")}
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
        {...(manage ? { actions: manage } : {})}
      />
      {templates.length === 0 ? (
        <EmptyState
          title={t("operations.contracts.templates.noneReadyTitle")}
          description={t(
            canManage
              ? "operations.contracts.templates.noneReadyAdmin"
              : "operations.contracts.templates.noneReadyBody",
          )}
          {...(manage ? { action: manage } : record ? { action: record } : {})}
        />
      ) : (
        <>
          <ul className={styles.templateGrid}>
            {templates.map((template) => (
              <li key={template.id}>
                <article
                  className={`${styles.card} ${styles.templateCard}`}
                  aria-labelledby={`template-${template.id}`}
                >
                  <div className={styles.badges}>
                    <StatusBadge tone="success">
                      {t("operations.contracts.templates.ready")}
                    </StatusBadge>
                    <StatusBadge tone="neutral">
                      {t(contractTypeLabels[template.contractType])}
                    </StatusBadge>
                  </div>
                  <div>
                    <h2 id={`template-${template.id}`}>{template.name}</h2>
                    <p className={styles.muted}>
                      {t(
                        template.requiresApproval
                          ? "operations.contracts.templates.readyWithApproval"
                          : "operations.contracts.templates.readyBody",
                        { version: template.version },
                      )}
                    </p>
                    {template.sections ? (
                      <p className={styles.muted}>
                        {t("operations.contractTemplates.optionalCount", {
                          count: template.sections,
                        })}
                      </p>
                    ) : null}
                  </div>
                  {canOpen ? (
                    <div className={styles.formActions}>
                      <Link
                        className={buttonClassName()}
                        href={
                          `/internal/contracts/templates/${template.id}` as Route
                        }
                        aria-label={t(
                          "operations.contracts.templates.prepareNamed",
                          { name: template.name },
                        )}
                      >
                        {t("operations.contracts.templates.prepare")}
                      </Link>
                    </div>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
          {record ? (
            <p className={styles.muted}>
              {t("operations.contracts.templates.otherAgreements")}{" "}
              <Link href="/internal/contracts/new">
                {t("operations.contracts.action.record")}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
