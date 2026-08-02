import { GlobalSearch } from "@/src/features/internal-ops/queue-search/global-search";
import { loadSearchRecords } from "@/src/features/internal-ops/queue-search/server-loader";

export default async function Page() {
  return <GlobalSearch records={await loadSearchRecords()} />;
}
