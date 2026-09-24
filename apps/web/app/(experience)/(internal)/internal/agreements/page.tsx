import type { Metadata } from "next";
import { listAgreementTemplates } from "@clockwork/db";
import { resolveDemoText } from "@clockwork/testing/demo-localized-text";
import { Table } from "@clockwork/ui";
import { AgreementAdministration } from "@/src/features/internal-ops/administration-safety/agreements";
import {
  adminSafetyCopy,
  agreementExecutionLabels,
  agreementStateLabels,
} from "@/src/features/internal-ops/administration-safety/copy";
import {
  agreementScanAt,
  agreementVersions,
} from "@/src/features/internal-ops/administration-safety/data";
import { AdministrationPage } from "@/src/features/internal-ops/administration-safety/ui";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { formatDate } from "@/src/features/shared/format";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import type { MessageId, Translator } from "@/src/i18n";
import {
  getFormattingLocale,
  getLocale,
  getTranslations,
} from "@/src/i18n/server";

export const dynamic = "force-dynamic";

/** The registry read returns at most one more than this, to detect overflow. */
const shownTemplates = 500;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t(adminSafetyCopy.agreements.title) };
}

/** A stored registry value as a label; an unknown value is shown as stored. */
function storedLabel(
  t: Translator,
  labels: Readonly<Record<string, MessageId>>,
  value: string,
): string {
  const id = Object.hasOwn(labels, value) ? labels[value] : undefined;
  return id ? t(id) : value;
}

export default async function Page() {
  if (explicitDemoIdentityEnabled()) {
    const locale = await getLocale();
    return (
      <AgreementAdministration
        roles={await getRouteRoles("internal")}
        versions={resolveDemoText(agreementVersions, locale)}
        scannedAt={agreementScanAt}
        readOnly
      />
    );
  }
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    // i18n-exempt: thrown to the route's error boundary, which shows its own copy
    throw new Error("Internal staff authority is required");
  const [t, formattingLocale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  const db = getOptionalServiceDatabase();
  const templates = db
    ? await listAgreementTemplates(
        db,
        `agreement-registry:${crypto.randomUUID()}`,
      )
    : null;
  return (
    <AdministrationPage
      title={t(adminSafetyCopy.agreements.title)}
      eyebrow={t("adminGovernance.agreements.registry.eyebrow")}
      description={t("adminGovernance.agreements.registry.description")}
    >
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2>{t("adminGovernance.agreements.registry.heading")}</h2>
        </div>
        {!templates ? (
          <p role="alert">
            {t("adminGovernance.agreements.registry.unavailable")}
          </p>
        ) : (
          <>
            {templates.length > shownTemplates ? (
              <p role="alert">
                {t("adminGovernance.agreements.registry.truncated", {
                  count: shownTemplates,
                })}
              </p>
            ) : null}
            <Table
              caption={t("adminGovernance.agreements.registry.caption")}
              headers={[
                t("adminGovernance.agreements.column.template"),
                t("adminGovernance.agreements.version"),
                t("adminGovernance.agreements.jurisdiction"),
                t("adminGovernance.agreements.effective"),
                t("common.status"),
                t("adminGovernance.agreements.execution"),
                t("adminGovernance.review.evidence"),
              ]}
              rowKeys={templates
                .slice(0, shownTemplates)
                .map((template) => template.id)}
              rows={templates.slice(0, shownTemplates).map((template) => [
                template.type,
                template.semanticVersion,
                template.jurisdiction,
                /^\d{4}-\d{2}-\d{2}$/u.test(template.effectiveOn)
                  ? formatDate(template.effectiveOn, formattingLocale)
                  : template.effectiveOn,
                storedLabel(t, agreementStateLabels, template.approvalStatus),
                storedLabel(
                  t,
                  agreementExecutionLabels,
                  template.executionMode,
                ),
                <details>
                  <summary>
                    {t("adminGovernance.agreements.registry.evidenceSummary")}
                  </summary>
                  <p>
                    {t("adminGovernance.agreements.registry.templateId", {
                      id: template.id,
                    })}
                  </p>
                  <p>
                    {t("adminGovernance.agreements.registry.documentId", {
                      id: template.canonicalDocumentId,
                    })}
                  </p>
                  <p>
                    {t("adminGovernance.agreements.registry.textHash", {
                      hash: template.textHash,
                    })}
                  </p>
                  <p>
                    {template.approvedBy
                      ? t("adminGovernance.agreements.registry.approvedBy", {
                          approver: template.approvedBy,
                        })
                      : t("adminGovernance.agreements.registry.notApproved")}
                  </p>
                </details>,
              ])}
              emptyState={t("adminGovernance.agreements.registry.empty")}
            />
          </>
        )}
      </section>
      {db ? (
        <SurfaceActionGate
          audience="internal"
          requiredPermission="agreement:approve"
        >
          <WorkflowPanel
            context={{}}
            workflow="agreementAdmin"
            surface="agreementAdmin"
          />
        </SurfaceActionGate>
      ) : null}
    </AdministrationPage>
  );
}
