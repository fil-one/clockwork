import type { Metadata } from "next";

import { HandoffQueue } from "@/src/features/internal-ops/handoff/handoff-queue";
import { handoffStatusFilter } from "@/src/features/internal-ops/handoff/model";
import { loadHandoffQueue } from "@/src/features/internal-ops/handoff/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.handoff.queue.title") };
}

async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const status = handoffStatusFilter((await searchParams).status);
  const loaded = await loadHandoffQueue(status);
  return (
    <HandoffQueue
      requests={loaded.kind === "ready" ? loaded.value.requests : null}
      status={status}
    />
  );
}

export default withStaffPermission("operations:read", Page);
