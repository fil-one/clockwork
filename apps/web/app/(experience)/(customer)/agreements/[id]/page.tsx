import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:read"
    >
      <CommercialRecordDetail id={id} />
    </SurfacePermissionGate>
  );
}
