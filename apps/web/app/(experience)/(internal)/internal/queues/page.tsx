import { Suspense } from "react";

import { QUEUE_COPY } from "@/src/features/internal-ops/queue-search/copy";
import { QueueWorkspace } from "@/src/features/internal-ops/queue-search/queue-workspace";
import type { OperationalRole } from "@/src/features/internal-ops/queue-search/model";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  const roles = (await getRouteRoles("internal")) as readonly OperationalRole[];
  return (
    <Suspense
      fallback={
        <main id="main-content" aria-busy="true">
          {QUEUE_COPY.loading}
        </main>
      }
    >
      <QueueWorkspace roles={roles} />
    </Suspense>
  );
}
