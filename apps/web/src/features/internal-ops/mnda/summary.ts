import "server-only";
import type { MndaStateCounts } from "@clockwork/contracts";
import { mndaRepository, mndaStaff } from "./server";

export interface MndaHomeSummary {
  /** Every request, by state. */
  byState: MndaStateCounts;
  /** Requests the signed-in seller prepared, by state. */
  mine: MndaStateCounts;
}

/**
 * Counts for the staff home. Returns null, rather than throwing, when the
 * session may not send MNDAs (no `mnda:send`, no MFA, assisted or demo
 * session) or the register cannot be read, so the home renders without it.
 * Link to the register with `?status=<states>&mine=1`.
 */
export async function loadMndaHomeSummary(): Promise<MndaHomeSummary | null> {
  try {
    const session = await mndaStaff("mnda:send");
    return await mndaRepository().countByState(session.userId);
  } catch {
    return null;
  }
}
