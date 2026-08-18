import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
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
  // The queues channel projects the `exception_case` aggregate, so the record
  // this page opened *is* the case `POST /v1/lifecycle/exceptions/{caseId}/
  // decisions` decides. The reference in the URL is the projection's record
  // key, not the case identifier, and the case identifier appears nowhere an
  // operator can read it.
  const queues = await loadPortalRecords("internal", "queues");
  const record = queues.records.find((candidate) => candidate.recordKey === id);
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  return (
    <ProjectionDetailPage
      audience="internal"
      channel="queues"
      recordKey={id}
      title="Queue record"
      description="Review data freshness, evidence, and the recorded next task."
      {...(!guidedDemo && record
        ? {
            actions: (
              <SurfaceActionGate
                audience="internal"
                requiredPermission="system:operate"
              >
                <WorkflowPanel
                  context={
                    record?.aggregateId ? { caseId: record.aggregateId } : {}
                  }
                  workflow="approval"
                  surface="queues"
                />
              </SurfaceActionGate>
            ),
          }
        : {})}
    />
  );
}
