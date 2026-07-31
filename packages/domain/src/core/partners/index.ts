import type { AccountCommercialRecord } from "../accounts";

export type DealCredit = "sourced" | "influenced" | "none";

export interface DealRegistration {
  id: string;
  partnerAccountId: string;
  endClientAccountId: string;
  workload: string;
  expectedVolume: string;
  status:
    | "registered"
    | "approved"
    | "expired"
    | "converted"
    | "rejected"
    | "disputed";
  protectionStartsAt: string;
  protectionEndsAt: string;
  credit: DealCredit;
  exclusion?: "house_account" | "prior_deal";
  dispute?: {
    ownerId: string;
    reason: string;
    tiebreak?: string;
    decidedAt?: string;
  };
}

export function registerDeal(input: {
  id: string;
  partner: AccountCommercialRecord;
  endClient: AccountCommercialRecord;
  workload: string;
  expectedVolume: string;
  registeredAt: string;
  protectionDays: number;
  houseAccountIds: ReadonlySet<string>;
  priorActiveDeals: readonly { endClientAccountId: string; workload: string }[];
}): DealRegistration {
  if (!input.partner.roles.includes("partner") || !input.partner.partner)
    throw new Error("Only a partner account can register a deal");
  if (input.partner.id === input.endClient.id)
    throw new Error("Partner cannot register itself as end client");
  if (!Number.isInteger(input.protectionDays) || input.protectionDays < 1)
    throw new Error("Protection window must be a positive whole day count");
  const start = Date.parse(input.registeredAt);
  if (Number.isNaN(start)) throw new Error("Registration time is invalid");
  const house = input.houseAccountIds.has(input.endClient.id);
  const prior = input.priorActiveDeals.some(
    (deal) =>
      deal.endClientAccountId === input.endClient.id &&
      deal.workload.toLocaleLowerCase() === input.workload.toLocaleLowerCase(),
  );
  const exclusion = house ? "house_account" : prior ? "prior_deal" : undefined;
  return {
    id: input.id,
    partnerAccountId: input.partner.id,
    endClientAccountId: input.endClient.id,
    workload: input.workload,
    expectedVolume: input.expectedVolume,
    status: exclusion ? "rejected" : "registered",
    protectionStartsAt: new Date(start).toISOString(),
    protectionEndsAt: new Date(
      start + input.protectionDays * 86_400_000,
    ).toISOString(),
    credit: exclusion ? "none" : "sourced",
    ...(exclusion ? { exclusion } : {}),
  };
}

export function evaluateRegistration(
  registration: DealRegistration,
  input: {
    now: string;
    action: "approve" | "reject" | "extend";
    extensionDays?: number;
  },
): DealRegistration {
  if (
    registration.status !== "registered" &&
    registration.status !== "approved"
  )
    throw new Error("Registration is not eligible for a decision");
  const now = Date.parse(input.now);
  if (
    now >= Date.parse(registration.protectionEndsAt) &&
    input.action !== "extend"
  )
    return { ...registration, status: "expired", credit: "none" };
  if (input.action === "extend") {
    if (
      !input.extensionDays ||
      !Number.isInteger(input.extensionDays) ||
      input.extensionDays < 1
    )
      throw new Error("Extension requires positive days");
    return {
      ...registration,
      protectionEndsAt: new Date(
        Date.parse(registration.protectionEndsAt) +
          input.extensionDays * 86_400_000,
      ).toISOString(),
    };
  }
  return {
    ...registration,
    status: input.action === "approve" ? "approved" : "rejected",
    credit: input.action === "approve" ? registration.credit : "none",
  };
}

export function disputeRegistration(
  registration: DealRegistration,
  input: { ownerId: string; reason: string },
): DealRegistration {
  if (
    registration.status !== "registered" &&
    registration.status !== "approved" &&
    registration.status !== "rejected"
  )
    throw new Error("Registration cannot enter dispute from its current state");
  if (!input.reason.trim()) throw new Error("Dispute reason is required");
  return { ...registration, status: "disputed", dispute: input };
}

export function decideRegistrationDispute(
  registration: DealRegistration,
  input: { tiebreak: string; decidedAt: string; credit: DealCredit },
): DealRegistration {
  if (registration.status !== "disputed" || !registration.dispute)
    throw new Error("Registration has no open dispute");
  if (!input.tiebreak.trim()) throw new Error("Recorded tiebreak is required");
  return {
    ...registration,
    status: input.credit === "none" ? "rejected" : "approved",
    credit: input.credit,
    dispute: {
      ...registration.dispute,
      tiebreak: input.tiebreak,
      decidedAt: input.decidedAt,
    },
  };
}

export function validatePartnerHierarchy(
  accounts: readonly AccountCommercialRecord[],
): void {
  const partners = new Map(
    accounts
      .filter((account) => account.partner)
      .map((account) => [account.id, account]),
  );
  for (const partner of partners.values()) {
    const parentId = partner.partner?.parentPartnerId;
    if (!parentId) continue;
    const parent = partners.get(parentId);
    if (!parent)
      throw new Error("Parent partner does not exist or lacks partner role");
    if (parent.partner?.parentPartnerId)
      throw new Error("Distributor-reseller hierarchy is limited to two tiers");
    if (parentId === partner.id)
      throw new Error("Partner hierarchy contains a cycle");
  }
}

export function merchantOfRecord(
  route: "direct" | "referral" | "resale" | "distributor" | "marketplace",
) {
  return route === "resale" || route === "distributor"
    ? "partner"
    : route === "marketplace"
      ? "marketplace"
      : "fil_one";
}
