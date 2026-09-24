import type { Metadata } from "next";
import Link from "next/link";
import {
  DatabaseProviderReferenceAdmin,
  managedProviders,
  type ProviderReferenceRow,
} from "@clockwork/db";
import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { formatSurfaceTimestamp } from "@/src/features/customer-partner/formatting";
import { AdministrationPage } from "@/src/features/internal-ops/administration-safety/ui";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import type { MessageId } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { richText } from "@/src/i18n/rich";
import { ProviderReferenceControls } from "./controls";

export const dynamic = "force-dynamic";
const labels: Record<(typeof managedProviders)[number], MessageId> = {
  billing: "adminGovernance.providers.name.billing",
  accounting: "adminGovernance.providers.name.accounting",
  notifications: "adminGovernance.providers.name.notifications",
  usage: "adminGovernance.providers.name.usage",
  workos: "adminGovernance.providers.name.workos",
  evidence: "adminGovernance.providers.name.evidence",
  provisioning: "adminGovernance.providers.name.provisioning",
  screening: "adminGovernance.providers.name.screening",
  signature: "adminGovernance.providers.name.signature",
  tax: "adminGovernance.providers.name.tax",
  crm: "adminGovernance.providers.name.crm",
  document_renderer: "adminGovernance.providers.name.documentRenderer",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminGovernance.providers.title") };
}

export default async function Page() {
  const session = await getCommerceSession();
  if (
    !session.isInternalStaff ||
    !session.roles.some(
      (role) => role === "internal_operator" || role === "finance_approver",
    )
  )
    // i18n-exempt: thrown to the route's error boundary, which shows its own copy
    throw new Error("Operator or finance authority is required");
  const [t, formattingLocale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  let rows: ProviderReferenceRow[] | null = null;
  try {
    const db = getOptionalServiceDatabase();
    if (db && session.providerBacked)
      rows = await new DatabaseProviderReferenceAdmin(db).list({
        actor: { kind: "user", id: session.userId },
        requestId: `provider-references:${crypto.randomUUID()}`,
      });
  } catch {
    rows = null;
  }
  const now = Date.now();
  /** Stored timestamps are UTC; show them in the reader's format, labelled. */
  const timestamp = (value: string) =>
    formatSurfaceTimestamp(value, {
      locale: formattingLocale,
      timeZone: "UTC",
    });
  return (
    <AdministrationPage
      title={t("adminGovernance.providers.title")}
      eyebrow={t("adminGovernance.providers.eyebrow")}
      description={t("adminGovernance.providers.description")}
    >
      <p className={styles.guidance}>
        {richText(t, "adminGovernance.providers.guidance", {
          gates: (
            <Link className={styles.proseLink} href="/internal/gates">
              {t("adminGovernance.providers.guidance.gatesLink")}
            </Link>
          ),
          capabilities: (
            <Link className={styles.proseLink} href="/internal/capabilities">
              {t("adminGovernance.providers.guidance.capabilitiesLink")}
            </Link>
          ),
        })}
      </p>
      {rows === null ? (
        <section className={styles.panel}>
          <div className={styles.panelBody}>
            <p role="status">
              {t(
                session.providerBacked
                  ? "adminGovernance.providers.registryUnavailable"
                  : "adminGovernance.providers.demoUnavailable",
              )}
            </p>
            <p>
              {t("adminGovernance.providers.covered", {
                providers: new Intl.ListFormat(formattingLocale, {
                  type: "conjunction",
                }).format(
                  managedProviders.map((provider) => t(labels[provider])),
                ),
              })}
            </p>
          </div>
        </section>
      ) : (
        rows.map((row) => (
          <section className={styles.panel} key={row.provider}>
            <div className={styles.panelHeading}>
              <h2>{t(labels[row.provider])}</h2>
              <span>
                {t(
                  !row.configuration
                    ? "adminGovernance.providers.state.notConfigured"
                    : row.source === "bootstrap"
                      ? "adminGovernance.providers.state.bootstrap"
                      : row.reviewDueAt && Date.parse(row.reviewDueAt) <= now
                        ? "adminGovernance.providers.state.reviewOverdue"
                        : "adminGovernance.providers.state.retained",
                )}
              </span>
            </div>
            <div className={styles.panelBody}>
              {row.configuration ? (
                <>
                  <dl>
                    <dt>{t("adminGovernance.providers.owner")}</dt>
                    <dd>{row.configuration.owner}</dd>
                    <dt>{t("adminGovernance.providers.secretReference")}</dt>
                    <dd>{row.configuration.secretReference}</dd>
                    <dt>{t("adminGovernance.providers.secretVersion")}</dt>
                    <dd>{row.configuration.secretVersion}</dd>
                    <dt>{t("adminGovernance.providers.lastRotation")}</dt>
                    <dd>{timestamp(row.configuration.rotatedAt)}</dd>
                    <dt>{t("adminGovernance.providers.reviewDue")}</dt>
                    <dd>
                      {t("adminGovernance.providers.reviewDueValue", {
                        date: row.reviewDueAt
                          ? timestamp(row.reviewDueAt)
                          : t("common.notRecorded"),
                        count: row.configuration.reviewIntervalDays,
                      })}
                    </dd>
                    <dt>{t("adminGovernance.providers.evidenceReference")}</dt>
                    <dd>{row.configuration.sourceEvidence}</dd>
                  </dl>
                  {row.source === "bootstrap" ? (
                    <p>{t("adminGovernance.providers.bootstrapNote")}</p>
                  ) : (
                    <p>
                      {t("adminGovernance.providers.registryVersion", {
                        version: row.rowVersion,
                        time: row.updatedAt
                          ? timestamp(row.updatedAt)
                          : t("common.notRecorded"),
                      })}
                    </p>
                  )}
                </>
              ) : (
                <p>{t("adminGovernance.providers.noReference")}</p>
              )}
            </div>
            <ProviderReferenceControls
              key={`${row.provider}:${row.rowVersion}`}
              row={row}
            />
          </section>
        ))
      )}
    </AdministrationPage>
  );
}
