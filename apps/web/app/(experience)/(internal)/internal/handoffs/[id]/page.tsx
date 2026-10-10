import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { HandoffDetailView } from "@/src/features/internal-ops/handoff/handoff-detail";
import { HandoffPageState } from "@/src/features/internal-ops/handoff/page-state";
import { loadHandoffDetail } from "@/src/features/internal-ops/handoff/server";
import { HandoffOrganizationStep } from "@/src/features/internal-ops/organizations/organization-views";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

const validId = (id: string) => /^[0-9a-f-]{36}$/iu.test(id);

/** One read per request, shared by the document title and the page. */
const load = cache((id: string) => loadHandoffDetail(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const [t, { id }] = await Promise.all([getTranslations(), params]);
  const loaded = validId(id) ? await load(id) : null;
  return {
    title:
      loaded?.kind === "ready"
        ? t("operations.handoff.detail.documentTitle", {
            name: loaded.value.request.counterpartyLegalName,
          })
        : t("operations.handoff.detail.title"),
  };
}

async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) notFound();
  const [loaded, identity] = await Promise.all([
    load(id),
    getRouteIdentity("internal"),
  ]);
  if (loaded.kind === "forbidden") notFound();
  if (loaded.kind !== "ready") return <HandoffPageState state={loaded.kind} />;
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
