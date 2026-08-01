import { Suspense } from "react";

import { SEARCH_COPY } from "@/src/features/internal-ops/queue-search/copy";
import { GlobalSearch } from "@/src/features/internal-ops/queue-search/global-search";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main id="main-content" aria-busy="true">
          {SEARCH_COPY.loading}
        </main>
      }
    >
      <GlobalSearch />
    </Suspense>
  );
}
