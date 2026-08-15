import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteSession } from "@/src/features/shell/route-session";
import { loadCommercialRecords } from "@/src/features/experience-server/portal-view-loader";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [session, projection] = await Promise.all([
    getRouteSession("customer"),
    loadCommercialRecords("orders"),
  ]);
  const canWrite = session.roles.some(
    (role) => role === "owner" || role === "admin",
  );
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:read">
      <CommercialCollectionPage
        freshness={{
          generatedAt: projection.generatedAt,
          stale: projection.stale,
        }}
        formatting={{ locale: session.locale, timeZone: session.timeZone }}
        canUsePrimaryAction={canWrite}
        kind="orders"
        records={projection.records}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
