import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { QuoteIssue } from "@/src/features/customer-partner/commercial/quote-issue";
import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("customer.commercial.detail.eyebrow.quotes") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [identity, record] = await Promise.all([
    getRouteIdentity("customer"),
    loadCommercialRecord("quotes", id),
  ]);
  const canWrite = identity.role === "owner" || identity.role === "admin";
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="quote:read">
      <CommercialRecordDetail
        canMutate={canWrite}
        id={id}
        record={record}
        actions={
          canWrite && record?.status === "draft" && record.aggregateId ? (
            <QuoteIssue
              accountId={identity.accountId}
              quoteId={record.aggregateId}
              recordKey={id}
            />
          ) : undefined
        }
      />
    </SurfacePermissionGate>
  );
}
