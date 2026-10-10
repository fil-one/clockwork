import "server-only";

import { z } from "zod";

import {
  ContractListQuerySchema,
  PartnerListQuerySchema,
} from "@clockwork/contracts";
import {
  PartnerRepository,
  type MndaContractMatch,
  type MndaRegisterMatch,
} from "@clockwork/db";
import { contractToday } from "@clockwork/domain/contract-terms";

import {
  explicitDemoIdentityEnabled,
  getRequestCommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoNow } from "@/src/features/experience-server/demo-clock";

import { contractReader } from "../contracts/demo-access";
import { demoContractRegister } from "../contracts/demo-register";
import {
  ContractAccessError,
  sessionHas,
  type ContractAccessFailure,
  type ContractStaffSession,
} from "../contracts/server";
import { mndaRepository } from "../mnda/server";
import { demoPartnerRegister } from "./demo-register";

/**
 * Partner records are read with `sales:read` and changed with
 * `contract:write`, through the service role, which row security does not
 * narrow: these checks are the guard. The guided demo reads fictional
 * records and changes nothing.
 */
export function partnerRepository() {
  if (explicitDemoIdentityEnabled())
    throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  const database = getOptionalServiceDatabase();
  if (!database) throw new Error("PARTNER_UNAVAILABLE");
  return new PartnerRepository(database);
}

/** The UTC day reads and defaults count from; the demo's pinned clock in tests. */
export const partnerToday = () => contractToday(demoNow());

export type PartnerReader = Pick<
  PartnerRepository,
  | "list"
  | "exportRows"
  | "get"
  | "owners"
  | "organizations"
  | "protectionDays"
  | "dealConflicts"
>;

/** The demo fixtures in the guided demo, as the signed-in persona sees them. */
export function partnerReader(session: ContractStaffSession): PartnerReader {
  return explicitDemoIdentityEnabled()
    ? demoPartnerRegister(demoNow(), {
        id: session.userId,
        name: session.profile.name,
      })
    : partnerRepository();
}

export const mayEditPartners = (session: ContractStaffSession) =>
  !explicitDemoIdentityEnabled() && sessionHas(session, "contract:write");

/** MNDAs and register contracts for the same company as a partner. */
export interface PartnerLinks {
  mndas: MndaRegisterMatch[];
  contracts: MndaContractMatch[];
}

/**
 * The PR #97 duplicate lookup, reused: MNDAs for readers who may open the
 * MNDA register and contracts for readers of the contract register, matched
 * with the MNDA company normalizer. The demo reads its fictional registers.
 */
async function partnerLinks(
  session: ContractStaffSession,
  name: string,
): Promise<PartnerLinks> {
  const mayOpenMndas = sessionHas(session, "mnda:send");
  const mayOpenContracts = sessionHas(session, "contract:read");
  if (explicitDemoIdentityEnabled()) {
    const now = demoNow();
    const { rows } = await demoContractRegister(now, {
      id: session.userId,
      name: session.profile.name,
      email: session.profile.email,
    }).list(ContractListQuerySchema.parse({ q: name }), contractToday(now), {
      includeMndas: mayOpenMndas,
      viewerId: session.userId,
    });
    return {
      mndas: rows
        .filter((row) => row.source === "mnda")
        .map((row) => ({
          id: row.id,
          company: row.counterpartyName,
          state: "completed",
          createdAt: row.updatedAt,
          completedAt: row.updatedAt,
          ownerName: row.ownerName,
        })),
      contracts: mayOpenContracts
        ? rows
            .filter((row) => row.source !== "mnda")
            .map((row) => ({
              id: row.id,
              counterpartyName: row.counterpartyName,
              contractType: row.contractType,
              status: row.status,
              effectiveDate: row.effectiveDate,
              ownerName: row.ownerName,
            }))
        : [],
    };
  }
  const repository = mndaRepository();
  const [mndas, contracts] = await Promise.all([
    mayOpenMndas ? repository.duplicates(name) : [],
    mayOpenContracts ? repository.contractDuplicates(name) : [],
  ]);
  return { mndas, contracts };
}

export type PartnerLoaded<T> =
  | ({ kind: "ready" } & T)
  | { kind: "denied"; code: ContractAccessFailure }
  | { kind: "missing" }
  | { kind: "error" };

/** Runs a page load behind the staff guard and turns refusals into states
 * the page can explain, instead of an error boundary. */
async function loadWith<T>(
  permission: "sales:read" | "contract:write",
  load: (session: ContractStaffSession) => Promise<T>,
): Promise<PartnerLoaded<T>> {
  try {
    // The demo reader admits reads only, so every form is refused there.
    const session = await contractReader(permission, getRequestCommerceSession);
    return { kind: "ready", ...(await load(session)) };
  } catch (error) {
    if (error instanceof ContractAccessError)
      return { kind: "denied", code: error.code };
    if (error instanceof Error && error.message === "PARTNER_NOT_FOUND")
      return { kind: "missing" };
    console.error("partners: page load failed", error);
    return { kind: "error" };
  }
}

export function loadPartnerList(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return loadWith("sales:read", async (session) => {
    const query = PartnerListQuerySchema.parse(searchParams);
    const today = partnerToday();
    const reader = partnerReader(session);
    const [result, owners] = await Promise.all([
      reader.list(query, { viewerId: session.userId, today }),
      reader.owners(),
    ]);
    return {
      query,
      today,
      result,
      owners,
      canEdit: mayEditPartners(session),
      demo: explicitDemoIdentityEnabled(),
    };
  });
}

export function loadPartner(id: string) {
  return loadWith("sales:read", async (session) => {
    if (!z.guid().safeParse(id).success) throw new Error("PARTNER_NOT_FOUND");
    const today = partnerToday();
    const reader = partnerReader(session);
    const detail = await reader.get(id, today);
    const canEdit = mayEditPartners(session);
    const [links, protectionDays, organizations] = await Promise.all([
      partnerLinks(session, detail.partner.name).catch((error: unknown) => {
        // The rest of the record still shows when the registers cannot.
        console.error("partners: linked records failed", error);
        return null;
      }),
      reader.protectionDays(),
      canEdit ? reader.organizations() : Promise.resolve([]),
    ]);
    return {
      ...detail,
      links,
      today,
      protectionDays,
      organizations,
      canEdit,
      demo: explicitDemoIdentityEnabled(),
    };
  });
}

/** The new-partner form, or the edit form for `id`. */
export function loadPartnerForm(id?: string) {
  return loadWith("contract:write", async (session) => {
    const repository = partnerRepository();
    const [partner, owners, organizations] = await Promise.all([
      id
        ? z.guid().safeParse(id).success
          ? repository.get(id, partnerToday()).then(({ partner }) => partner)
          : Promise.reject(new Error("PARTNER_NOT_FOUND"))
        : Promise.resolve(null),
      repository.owners(),
      repository.organizations(),
    ]);
    return {
      partner,
      owners,
      organizations,
      viewer: { id: session.userId, name: session.profile.name },
    };
  });
}
