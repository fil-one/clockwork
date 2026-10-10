import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { OrganizationInvites } from "@/src/features/internal-ops/organizations/organization-invites";
import {
  OrganizationDetail,
  OrganizationPageState,
} from "@/src/features/internal-ops/organizations/organization-views";
import { loadOrganization } from "@/src/features/internal-ops/organizations/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

const validId = (id: string) => /^[0-9a-f-]{36}$/iu.test(id);

/** One read per request, shared by the document title and the page. */
const load = cache((id: string) => loadOrganization(id));

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
        ? t("operations.organizations.detail.documentTitle", {
            name: loaded.value.organization.legalName,
          })
        : t("operations.organizations.detail.title"),
  };
}

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!validId(id)) notFound();
  const loaded = await load(id);
  if (loaded.kind === "forbidden") notFound();
  if (loaded.kind !== "ready")
    return (
      <OrganizationPageState
        heading="operations.organizations.detail.title"
        state={loaded.kind}
        unavailable="operations.organizations.detail.unavailable"
      />
    );
  const { organization, invites, canWrite } = loaded.value;
  return (
    <OrganizationDetail
      organization={organization}
      created={query.created === "1"}
    >
      <OrganizationInvites
        organizationId={organization.organizationId}
        side={organization.side}
        invites={invites}
        canWrite={canWrite}
      />
    </OrganizationDetail>
  );
}

export default withStaffPermission("operations:read", Page);
