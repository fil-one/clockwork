import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { PartnerPortfolioDetail } from "@/src/features/customer-partner/partner/partner-detail";
import { demoPartnerPortfolioRenewalContext } from "@/src/features/customer-partner/partner/demo-partner-renewal";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  /*
   * A partner's portfolio row is an end-client *account*: `account` projects to
   * the partner's `portfolio` channel, keyed on the partner as the audience and
   * carrying the end client as the aggregate. So `aggregateId` here is the end
   * client's account identifier -- the account any renewal on this page is
   * about, and not one the partner can read anywhere on screen.
   *
   * `POST /v1/lifecycle/renewals/{orderId}/...` still binds on the order rather
   * than the projected account. The guided demo resolves that hidden binding
   * from its fixed partner relationship below; production refuses the action
   * unless its authorized record loader supplies an account and leaves the
   * missing order inert rather than asking a partner to guess it.
   */
  const portfolio = await loadPortalRecords("partner", "portfolio");
  const record = portfolio.records.find(
    (candidate) => candidate.recordKey === id,
  );
  const renewalContext = demoDeployIdentityEnabled(process.env)
    ? demoPartnerPortfolioRenewalContext(id)
    : record?.aggregateId
      ? { accountId: record.aggregateId }
      : {};
  return (
    <PartnerPortfolioDetail
      actions={
        <SurfaceActionGate audience="partner" requiredPermission="order:write">
          <WorkflowPanel
            context={renewalContext ?? {}}
            workflow="renewal"
            surface="partnerRenewals"
          />
        </SurfaceActionGate>
      }
      id={id}
    />
  );
}
