import "server-only";

import {
  HandoffRequestRepository,
  type HandoffContractContext,
  type HandoffRequestDetail,
} from "@clockwork/db";
import type { HandoffRequestRecord, HandoffStatus } from "@clockwork/contracts";

import {
  explicitDemoIdentityEnabled,
  getRequestCommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import {
  ContractAccessError,
  contractStaff,
  sessionHas,
  type ContractStaffSession,
} from "../contracts/server";

/**
 * The guided demo and a deployment without a database keep no handoffs. The
 * service role does not narrow rows: operations reads the queue under
 * `operations:read`, and a seller reads only the requests they raised.
 */
export function handoffRepository() {
  if (explicitDemoIdentityEnabled())
    throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  const database = getOptionalServiceDatabase();
  if (!database) throw new Error("HANDOFF_UNAVAILABLE");
  return new HandoffRequestRepository(database);
}

/** Whether the reader may take, complete and decline handoffs. */
export const mayWorkHandoffs = (session: ContractStaffSession) =>
  sessionHas(session, "operations:write");

export type Loaded<T> =
  { kind: "ready"; value: T } | { kind: "unavailable" } | { kind: "forbidden" };

async function load<T>(
  permission: "operations:read" | "contract:write",
  read: (session: ContractStaffSession) => Promise<T>,
): Promise<Loaded<T>> {
  if (explicitDemoIdentityEnabled() || !getOptionalServiceDatabase())
    return { kind: "unavailable" };
  let session: ContractStaffSession;
  try {
    session = await contractStaff(permission, getRequestCommerceSession);
  } catch {
    return { kind: "forbidden" };
  }
  try {
    return { kind: "ready", value: await read(session) };
  } catch (error) {
    if (error instanceof Error && error.message === "HANDOFF_NOT_FOUND")
      return { kind: "forbidden" };
    console.error("Handoffs could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { kind: "unavailable" };
  }
}

/** The operations queue, optionally one status. */
export function loadHandoffQueue(status: HandoffStatus | undefined) {
  return load<{ requests: HandoffRequestRecord[] }>(
    "operations:read",
    async () => ({
      requests: await handoffRepository().list({ kind: "all" }, status),
    }),
  );
}

/** One request, with what operations may do to it. */
export function loadHandoffDetail(id: string) {
  return load<{ request: HandoffRequestDetail; canWork: boolean }>(
    "operations:read",
    async (session) => ({
      request: await handoffRepository().get(id, { kind: "all" }),
      canWork: mayWorkHandoffs(session),
    }),
  );
}

/**
 * The contract record's handoff panel, for anyone who may raise one. The
 * scenario picker follows the rule the write applies: a seller's own
 * scenarios, or every seller's for a commerce administrator.
 */
export function loadContractHandoff(contractId: string) {
  return load<HandoffContractContext>("contract:write", (session) =>
    handoffRepository().contractContext(
      contractId,
      session.roles.includes("commerce_admin")
        ? { kind: "all" }
        : { kind: "own", userId: session.userId },
    ),
  );
}

/** The seller's own requests for the home page; null leaves the card out. */
export async function loadOwnHandoffs(): Promise<
  HandoffRequestRecord[] | null
> {
  const loaded = await load("contract:write", (session) =>
    handoffRepository().list({ kind: "own", userId: session.userId }),
  );
  return loaded.kind === "ready" ? loaded.value : null;
}
