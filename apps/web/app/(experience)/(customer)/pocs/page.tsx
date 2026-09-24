import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCommercialRecords } from "@/src/features/experience-server/portal-view-loader";
import { getRouteSession } from "@/src/features/shell/route-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("customer.commercial.collection.pocs.title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [session, projection] = await Promise.all([
    getRouteSession("customer"),
    loadCommercialRecords("pocs"),
  ]);
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="poc:manage">
      <CommercialCollectionPage
        freshness={{
          generatedAt: projection.generatedAt,
          partial: projection.truncated,
          stale: projection.stale,
        }}
        formatting={{ locale: session.locale, timeZone: session.timeZone }}
        kind="pocs"
        records={projection.records}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
