import Link from "next/link";
import {
  DatabaseProviderReferenceAdmin,
  managedProviders,
  type ProviderReferenceRow,
} from "@clockwork/db";
import { getCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { AdministrationPage } from "@/src/features/internal-ops/administration-safety/ui";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { ProviderReferenceControls } from "./controls";

export const dynamic = "force-dynamic";
const labels: Record<(typeof managedProviders)[number], string> = {
  billing: "Billing",
  accounting: "Accounting",
  notifications: "Notifications",
  usage: "Usage metering",
  workos: "Identity (WorkOS)",
  evidence: "Evidence storage",
  provisioning: "Storage provisioning",
  screening: "Screening",
  signature: "Signatures",
  tax: "Tax",
  crm: "CRM",
  document_renderer: "Document rendering",
};
export default async function Page() {
  const session = await getCommerceSession();
  if (
    !session.isInternalStaff ||
    !session.roles.some(
      (role) => role === "internal_operator" || role === "finance_approver",
    )
  )
    throw new Error("Operator or finance authority is required");
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
  return (
    <AdministrationPage
      title="Provider operating references"
      eyebrow="Commercial administration"
      description="Maintain ownership, secret-manager references and rotation review dates for commerce providers."
    >
      <p className={styles.guidance}>
        Rotate credentials in your secret manager and deployment first, then
        record the evidence here. These records are operator attestations; they
        do not connect a provider or prove its credentials work.{" "}
        <Link className={styles.proseLink} href="/internal/gates">
          Review integration qualification gates
        </Link>{" "}
        and{" "}
        <Link className={styles.proseLink} href="/internal/capabilities">
          capability controls
        </Link>
        .
      </p>
      {rows === null ? (
        <section className={styles.panel}>
          <div className={styles.panelBody}>
            <p role="status">
              {session.providerBacked
                ? "Provider reference registry unavailable. Check the control database connection and your current authority, then refresh."
                : "Live provider references are not connected in this demo. Reference administration requires a verified staff session and the control database."}
            </p>
            <p>
              Providers covered:{" "}
              {managedProviders.map((provider) => labels[provider]).join(", ")}.
            </p>
          </div>
        </section>
      ) : (
        rows.map((row) => (
          <section className={styles.panel} key={row.provider}>
            <div className={styles.panelHeading}>
              <h2>{labels[row.provider]}</h2>
              <span>
                {!row.configuration
                  ? "Not configured"
                  : row.source === "bootstrap"
                    ? "Bootstrap reference · owner review needed"
                    : row.reviewDueAt && Date.parse(row.reviewDueAt) <= now
                      ? "Rotation review overdue"
                      : "Reference retained"}
              </span>
            </div>
            <div className={styles.panelBody}>
              {row.configuration ? (
                <>
                  <dl>
                    <dt>Operating owner</dt>
                    <dd>{row.configuration.owner}</dd>
                    <dt>Secret-manager reference</dt>
                    <dd>{row.configuration.secretReference}</dd>
                    <dt>Secret version</dt>
                    <dd>{row.configuration.secretVersion}</dd>
                    <dt>Last recorded rotation</dt>
                    <dd>{row.configuration.rotatedAt}</dd>
                    <dt>Rotation review due</dt>
                    <dd>
                      {row.reviewDueAt} ({row.configuration.reviewIntervalDays}{" "}
                      days)
                    </dd>
                    <dt>Evidence reference</dt>
                    <dd>{row.configuration.sourceEvidence}</dd>
                  </dl>
                  {row.source === "bootstrap" ? (
                    <p>
                      Imported from the immutable bootstrap manifest. The 90-day
                      review interval is a suggested default until an owner
                      saves the operating policy.
                    </p>
                  ) : (
                    <p>
                      Registry version {row.rowVersion} · last updated{" "}
                      {row.updatedAt}.
                    </p>
                  )}
                </>
              ) : (
                <p>
                  No credential reference is retained for this provider. Record
                  a reference after its deployment and evidence are available.
                </p>
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
