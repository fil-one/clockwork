import type { Metadata } from "next";

import { GlobalSearch } from "@/src/features/internal-ops/queue-search/global-search";
import { loadSearchRecords } from "@/src/features/internal-ops/queue-search/server-loader";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.search.title") };
}

export default async function Page() {
  return <GlobalSearch records={await loadSearchRecords()} />;
}
