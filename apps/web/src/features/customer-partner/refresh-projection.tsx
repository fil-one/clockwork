"use client";

import { useRouter } from "next/navigation";

/**
 * The refresh half of the stale disclosure, split out because it is the only
 * part that needs the client.
 *
 * `router.refresh()` rather than a link back to the same URL: a link would be
 * served from the router cache and could return the same stale payload without
 * the reader being able to tell, which is the failure this control exists to
 * end. This is the same control `/internal/queues` gives operators; customers
 * and partners now get it too.
 */
export function RefreshProjection({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button onClick={() => router.refresh()} type="button">
      {label}
    </button>
  );
}
