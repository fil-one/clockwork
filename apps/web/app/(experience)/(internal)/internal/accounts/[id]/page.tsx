import { AccountDerivationSection } from "@/src/features/experience-server/account-derivation-section";
import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ProjectionDetailPage
      audience="internal"
      channel="dashboard"
      recordKey={id}
      title="Account operations"
      description="Assisted access remains restricted to the persisted effective account."
      actions={
        <SurfaceActionGate audience="internal" requiredPermission="report:read">
          <WorkflowPanel workflow="reports" surface="reports" />
        </SurfaceActionGate>
      }
      supporting={<AccountDerivationSection recordKey={id} />}
    />
  );
}
