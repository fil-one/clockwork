import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRoutePermissions } from "@/src/features/shell/route-session";

/**
 * The detail page for one live entitlement.
 *
 * Every other commercial channel had one; `services` did not, so `recordRoute`
 * answered the list path for it and each row on `/services` linked back to the
 * page the reader was already on. `CommercialRecordDetail` already renders
 * `kind === "services"` -- its own heading, its own next step -- so the surface
 * existed and only the route was missing.
 *
 * The read gate matches `/services`: `order:read`. `canMutate` gates the one
 * forward action this record has, "Request offboarding", whose destination
 * `/account/offboarding` is gated on `account:write`, so a reader who would be
 * refused there is shown the explanation here instead of a link that denies
 * them.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [permissions, record] = await Promise.all([
    getRoutePermissions("customer"),
    loadCommercialRecord("services", id),
  ]);
  const canOffboard = permissions.includes("account:write");
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:read">
      <CommercialRecordDetail canMutate={canOffboard} id={id} record={record} />
    </SurfacePermissionGate>
  );
}
