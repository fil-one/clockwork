import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrganizationDetail } from "@/src/features/internal-ops/organizations/organization-views";
import { loadOrganization } from "@/src/features/internal-ops/organizations/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.organizations.title") };
}

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/iu.test(id)) notFound();
  const loaded = await loadOrganization(id);
  if (loaded.kind === "forbidden") notFound();
  if (loaded.kind === "unavailable") throw new Error("ONBOARDING_UNAVAILABLE");
  return (
    <OrganizationDetail
      organization={loaded.value.organization}
      created={query.created === "1"}
    />
  );
}

export default withStaffPermission("operations:read", Page);
