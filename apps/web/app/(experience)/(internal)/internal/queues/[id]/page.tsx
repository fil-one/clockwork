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
      channel="queues"
      recordKey={id}
      title="Queue record"
      description="Review source freshness, evidence, and the version-bound next task."
      actions={
        <SurfaceActionGate
          audience="internal"
          requiredPermission="system:operate"
        >
          <WorkflowPanel workflow="approval" surface="queues" />
        </SurfaceActionGate>
      }
    />
  );
}
