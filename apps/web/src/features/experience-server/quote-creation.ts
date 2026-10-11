import "server-only";

import { getCapabilityState } from "@/src/features/internal-ops/capability-state";
import { quoteCreationOpen } from "@/src/features/internal-ops/capability-state-model";

/**
 * Whether this session's surfaces may offer something to quote or buy: quote
 * creation's switches are on. Customer and partner pages read it here, so an
 * active price book alone never presents a purchase the server would refuse.
 */
export async function quoteCreationOpenFor(session: {
  providerBacked: boolean;
}): Promise<boolean> {
  return quoteCreationOpen(await getCapabilityState(session));
}
