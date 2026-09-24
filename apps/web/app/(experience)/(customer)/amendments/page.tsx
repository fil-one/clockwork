import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { CustomerCollection } from "@/src/features/customer-partner/customer/customer-collection";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import type { RawCollectionSearchParams } from "@/src/features/customer-partner/customer/collection-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCustomerCollectionRecords } from "@/src/features/experience-server/portal-view-loader";
import { getRouteSession } from "@/src/features/shell/route-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("customer.commercial.page.amendments") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawCollectionSearchParams>;
}) {
  const [session, projection] = await Promise.all([
    getRouteSession("customer"),
    loadCustomerCollectionRecords("amendments"),
  ]);
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="order:write">
      <CustomerCollection
        freshness={{
          generatedAt: projection.generatedAt,
          partial: projection.truncated,
          stale: projection.stale,
        }}
        formatting={{ locale: session.locale, timeZone: session.timeZone }}
        config={{
          ...customerCollections.amendments,
          records: projection.records,
        }}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
