import type { Route } from "next";
import Link from "next/link";
import type { ContractType } from "@clockwork/contracts";
import { PageHeader, StatusBadge, buttonClassName } from "@clockwork/ui";
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
 * Every agreement Fil One can prepare from approved wording. A template that
 * legal has not supplied is listed so the team knows it is coming, but it
 * cannot be selected.
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
  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        title={t("operations.contracts.templates.title")}
        description={t("operations.contracts.templates.description")}
        actions={
          <Link
            className={buttonClassName({ variant: "secondary" })}
            href="/internal/contracts"
          >
            {t("operations.contracts.backToRegister")}
          </Link>
        }
      />
      <ul className={styles.templateGrid}>
        {templates.map((template) => {
          const name = t(contractTypeLabels[template.contractType]);
          const available = template.status === "available";
          return (
            <li key={template.id}>
              <article
                className={`${styles.card} ${styles.templateCard}`}
                aria-labelledby={`template-${template.id}`}
              >
                <div className={styles.badges}>
                  <StatusBadge tone={available ? "success" : "warning"}>
                    {t(
                      available
                        ? "operations.contracts.templates.ready"
                        : "operations.contracts.templates.pending",
                    )}
                  </StatusBadge>
                </div>
                <div>
                  <h2 id={`template-${template.id}`}>{name}</h2>
                  <p className={styles.muted}>
                    {available
                      ? t(
                          template.requiresApproval
                            ? "operations.contracts.templates.readyWithApproval"
                            : "operations.contracts.templates.readyBody",
                          { version: template.version ?? "" },
                        )
                      : t("operations.contracts.templates.pendingBody")}
                  </p>
                </div>
                <div className={styles.formActions}>
                  {available && canWrite ? (
                    <Link
                      className={buttonClassName()}
                      href={
                        `/internal/contracts/templates/${template.id}` as Route
                      }
                      aria-label={t(
                        "operations.contracts.templates.prepareNamed",
                        {
                          name,
                        },
                      )}
                    >
                      {t("operations.contracts.templates.prepare")}
                    </Link>
                  ) : null}
                  {!available && canWrite ? (
                    <Link
                      className={buttonClassName({ variant: "secondary" })}
                      href={
                        `/internal/contracts/new?type=${template.contractType}` as Route
                      }
                      aria-label={t(
                        "operations.contracts.templates.recordNamed",
                        {
                          name,
                        },
                      )}
                    >
                      {t("operations.contracts.templates.recordInstead")}
                    </Link>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
