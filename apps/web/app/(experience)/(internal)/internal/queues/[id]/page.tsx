import Link from "next/link";

import {
  QUEUE_ITEMS,
  type OperationalRole,
} from "@/src/features/internal-ops/queue-search/model";
import {
  QueueDetail,
  QueueDetailNotFound,
} from "@/src/features/internal-ops/queue-search/queue-detail";
import styles from "@/src/features/internal-ops/queue-search/queue-search.module.css";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = QUEUE_ITEMS.find((candidate) => candidate.id === id);
  if (!item) return <QueueDetailNotFound id={id} />;
  const roles = (await getRouteRoles("internal")) as readonly OperationalRole[];
  return (
    <main className={styles.page} id="main-content">
      <Link className={styles.secondaryButton} href="/internal/queues">
        ← Back to queues
      </Link>
      <QueueDetail item={item} roles={roles} standalone />
    </main>
  );
}
