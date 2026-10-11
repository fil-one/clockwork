import type { Metadata } from "next";

import { StaffAccessTokens } from "@/src/features/internal-ops/access-tokens/access-tokens";
import { loadStaffAccessTokens } from "@/src/features/internal-ops/access-tokens/server";
import { loadTeamView } from "@/src/features/internal-ops/team/server";
import { TeamWorkspace } from "@/src/features/internal-ops/team/team-workspace";
import {
  parseStaffRoleReviewQuery,
  resolveStaffRoleReview,
  type StaffRoleReview,
} from "@/src/features/internal-ops/team/role-review";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  // The root template appends the product name.
  return { title: t("operations.team.title") };
}

async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [view, tokens, query] = await Promise.all([
    loadTeamView(),
    loadStaffAccessTokens(),
    searchParams,
  ]);
  const request = parseStaffRoleReviewQuery(query);
  const review: StaffRoleReview | null =
    request === "invalid"
      ? { state: "error", code: "REVIEW_INVALID" }
      : request
        ? resolveStaffRoleReview(view, request)
        : null;
  return (
    <TeamWorkspace
      view={view}
      review={review}
      reviewKey={JSON.stringify(query)}
    >
      <StaffAccessTokens view={tokens} />
    </TeamWorkspace>
  );
}

export default withStaffPermission("staff:manage", Page);
