import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { loadCommercialRecord } from "@/src/features/experience-server/portal-view-loader";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("customer.commercial.detail.eyebrow.agreements") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await loadCommercialRecord("agreements", id);
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:read"
    >
      <CommercialRecordDetail id={id} record={record} />
    </SurfacePermissionGate>
  );
}
