import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HandoffDetailView } from "@/src/features/internal-ops/handoff/handoff-detail";
import { loadHandoffDetail } from "@/src/features/internal-ops/handoff/server";
import { HandoffOrganizationStep } from "@/src/features/internal-ops/organizations/organization-views";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.handoff.detail.title") };
}

async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/iu.test(id)) notFound();
  const [loaded, identity] = await Promise.all([
    loadHandoffDetail(id),
    getRouteIdentity("internal"),
  ]);
  if (loaded.kind === "forbidden") notFound();
  if (loaded.kind === "unavailable") throw new Error("HANDOFF_UNAVAILABLE");
  const { request, canWork } = loaded.value;
  return (
    <HandoffDetailView
      request={request}
      canWork={canWork}
      readerId={identity.userId}
    >
      <HandoffOrganizationStep
        handoffId={request.id}
        organizationId={request.organizationId}
        status={request.status}
        canWork={canWork}
      />
    </HandoffDetailView>
  );
}

export default withStaffPermission("operations:read", Page);
