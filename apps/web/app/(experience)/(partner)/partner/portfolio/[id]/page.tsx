import { PartnerPortfolioDetail } from "@/src/features/customer-partner/partner/partner-detail";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PartnerPortfolioDetail
      actions={
        <SurfaceActionGate audience="partner" requiredPermission="order:write">
          <WorkflowPanel workflow="renewal" surface="partnerRenewals" />
        </SurfaceActionGate>
      }
      id={id}
    />
  );
}
