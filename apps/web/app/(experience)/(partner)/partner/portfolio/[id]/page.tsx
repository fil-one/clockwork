import { PartnerPortfolioDetail } from "@/src/features/customer-partner/partner/partner-detail";
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
   * The order is a different matter, and it is why this panel still refuses.
   * `POST /v1/lifecycle/renewals/{orderId}/...` binds on the order, and this
   * surface carries no order: the portfolio channel projects accounts, and
   * partner-visible orders live on the `orders` channel that no route here
   * reads. Resolving that is the systemic wiring another work-stream owns. What
   * is fixed is that the panel now says the order is missing and posts nothing,
   * instead of asking a partner to type an order identifier they have never
   * been shown and silently doing nothing when they cannot.
   */
  const portfolio = await loadPortalRecords("partner", "portfolio");
  const record = portfolio.records.find(
    (candidate) => candidate.recordKey === id,
  );
  return (
    <PartnerPortfolioDetail
      actions={
        <SurfaceActionGate audience="partner" requiredPermission="order:write">
          <WorkflowPanel
            context={
              record?.aggregateId ? { accountId: record.aggregateId } : {}
            }
            workflow="renewal"
            surface="partnerRenewals"
          />
        </SurfaceActionGate>
      }
      id={id}
    />
  );
}
