import { listAgreementTemplates } from "@clockwork/db";
import { Table } from "@clockwork/ui";
import { AgreementAdministration } from "@/src/features/internal-ops/administration-safety/agreements";
import { AdministrationPage } from "@/src/features/internal-ops/administration-safety/ui";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (explicitDemoIdentityEnabled())
    return (
      <AgreementAdministration
        roles={await getRouteRoles("internal")}
        readOnly
      />
    );
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    throw new Error("Internal staff authority is required");
  const db = getOptionalServiceDatabase();
  const templates = db
    ? await listAgreementTemplates(
        db,
        `agreement-registry:${crypto.randomUUID()}`,
      )
    : null;
  return (
    <AdministrationPage
      title="Agreement templates"
      eyebrow="Legal administration"
      description="Canonical versions, exact text hashes, effective dates, and approval attribution from the agreement registry."
    >
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2>Published and draft versions</h2>
        </div>
        {!templates ? (
          <p role="alert">
            Agreement registry unavailable. Connect the service database to
            inspect canonical templates.
          </p>
        ) : (
          <>
            {templates.length > 500 ? (
              <p role="alert">
                Showing the 500 most recent templates. Older versions remain in
                the registry.
              </p>
            ) : null}
            <Table
              caption="Canonical agreement templates"
              headers={[
                "Template",
                "Version",
                "Jurisdiction",
                "Effective",
                "State",
                "Execution",
                "Evidence",
              ]}
              rowKeys={templates.slice(0, 500).map((template) => template.id)}
              rows={templates.slice(0, 500).map((template) => [
                template.type,
                template.semanticVersion,
                template.jurisdiction,
                template.effectiveOn,
                template.approvalStatus,
                template.executionMode.replaceAll("_", " "),
                <details>
                  <summary>Exact version evidence</summary>
                  <p>Template: {template.id}</p>
                  <p>Document: {template.canonicalDocumentId}</p>
                  <p>Text hash: {template.textHash}</p>
                  <p>Approved by: {template.approvedBy ?? "Not approved"}</p>
                </details>,
              ])}
              emptyState="No canonical agreement templates have been published."
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
