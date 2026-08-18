import Link from "next/link";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { AccountDerivationSection } from "@/src/features/experience-server/account-derivation-section";
import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A report run from an account's page is a report about that account. The
  // internal `dashboard` channel projects the `account` aggregate, so the
  // record opened here supplies the account the report is scoped to; the
  // report's account filter is otherwise a UUID an operator would have to
  // fetch from somewhere else and paste back in.
  const accounts = await loadPortalRecords("internal", "dashboard");
  const record = accounts.records.find(
    (candidate) => candidate.recordKey === id,
  );
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  return (
    <ProjectionDetailPage
      audience="internal"
      channel="dashboard"
      recordKey={id}
      title="Account operations"
      description="Assisted access remains restricted to the persisted effective account."
      actions={
        <SurfaceActionGate audience="internal" requiredPermission="report:read">
          {guidedDemo ? (
            <Link href="/internal/reports">Open reports workspace</Link>
          ) : (
            <WorkflowPanel
              context={
                record?.aggregateId ? { accountId: record.aggregateId } : {}
              }
              workflow="reports"
              surface="reports"
            />
          )}
        </SurfaceActionGate>
      }
      supporting={<AccountDerivationSection recordKey={id} />}
    />
  );
}
