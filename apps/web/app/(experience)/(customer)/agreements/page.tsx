import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { CommercialCollectionPage } from "@/src/features/customer-partner/commercial/collection-page";
import type { RawSearchParams } from "@/src/features/customer-partner/commercial/url-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteSession } from "@/src/features/shell/route-session";
import { loadCommercialRecords } from "@/src/features/experience-server/portal-view-loader";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("customer.commercial.collection.agreements.title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [session, projection] = await Promise.all([
    getRouteSession("customer"),
    loadCommercialRecords("agreements"),
  ]);
  const canExecute = session.roles.some(
    (role) => role === "owner" || role === "admin",
  );
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:read"
    >
      <CommercialCollectionPage
        freshness={{
          generatedAt: projection.generatedAt,
          partial: projection.truncated,
          stale: projection.stale,
        }}
        formatting={{ locale: session.locale, timeZone: session.timeZone }}
        canUsePrimaryAction={canExecute}
        kind="agreements"
        records={projection.records}
        searchParams={await searchParams}
      />
    </SurfacePermissionGate>
  );
}
