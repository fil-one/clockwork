import "server-only";

import { z } from "zod";

import {
  HubSpotIdSchema,
  HubSpotPipelineQuerySchema,
  type HubSpotFieldHistory,
  type HubSpotImportRecord,
  type PartnerOwnerOption,
  type PartnerRecord,
} from "@clockwork/contracts";
import { HubSpotError } from "@clockwork/integrations/hubspot";

import {
  explicitDemoIdentityEnabled,
  getRequestCommerceSession,
} from "@/src/auth/session";

import { contractReader } from "../contracts/demo-access";
import {
  ContractAccessError,
  sessionHas,
  type ContractAccessFailure,
  type ContractStaffSession,
} from "../contracts/server";
import {
  partnerReader,
  partnerRepository,
  partnerToday,
} from "../partners/server";
import {
  configuredPortal,
  hubspotContext,
  hubspotRepository,
  HubSpotUnavailableError,
  loadDealChoice,
  loadDealPeople,
  loadHandoffSource,
  loadPartnerHubSpot,
  loadPipeline,
  searchHubSpot,
  settingsCatalog,
  type HubSpotContext,
} from "./server";

export type HubSpotLoaded<T> =
  | ({ kind: "ready" } & T)
  | { kind: "denied"; code: ContractAccessFailure }
  /** HubSpot itself: not configured, not connected, another portal, or a
   * provider failure the page can explain. */
  | { kind: "unavailable"; code: string; canManage: boolean }
  | { kind: "missing" }
  | { kind: "error" };

async function loadWith<T>(
  permission: "sales:read" | "contract:write" | "staff:manage",
  load: (session: ContractStaffSession) => Promise<T>,
): Promise<HubSpotLoaded<T>> {
  let session: ContractStaffSession;
  try {
    session = await contractReader(
      permission === "staff:manage" && explicitDemoIdentityEnabled()
        ? "sales:read"
        : permission,
      getRequestCommerceSession,
    );
  } catch (error) {
    if (error instanceof ContractAccessError)
      return { kind: "denied", code: error.code };
    console.error("hubspot: session failed", error);
    return { kind: "error" };
  }
  try {
    return { kind: "ready", ...(await load(session)) };
  } catch (error) {
    const canManage = sessionHas(session, "staff:manage");
    if (error instanceof ContractAccessError)
      return { kind: "denied", code: error.code };
    if (
      error instanceof HubSpotUnavailableError ||
      error instanceof HubSpotError
    )
      return { kind: "unavailable", code: error.code, canManage };
    if (error instanceof Error) {
      if (
        [
          "PARTNER_NOT_FOUND",
          "HUBSPOT_IMPORT_NOT_FOUND",
          "HUBSPOT_RECORD_NOT_FOUND",
        ].includes(error.message)
      )
        return { kind: "missing" };
      if (/^HUBSPOT_[A-Z_]+$/.test(error.message))
        return { kind: "unavailable", code: error.message, canManage };
    }
    console.error("hubspot: page load failed", error);
    return { kind: "error" };
  }
}

const mayImport = (session: ContractStaffSession) =>
  !explicitDemoIdentityEnabled() && sessionHas(session, "contract:write");

const optionalId = (value: unknown) => {
  const first = Array.isArray(value) ? (value as unknown[])[0] : value;
  return HubSpotIdSchema.safeParse(first).success ? (first as string) : null;
};
const optionalGuid = (value: unknown) => {
  const first = Array.isArray(value) ? (value as unknown[])[0] : value;
  return z.guid().safeParse(first).success ? (first as string) : null;
};
const text = (value: unknown) => {
  const first = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof first === "string" ? first.slice(0, 200) : "";
};

type Params = Record<string, string | string[] | undefined>;

/** The search-first picker: companies and deals, or a pasted record link. */
export function loadPicker(params: Params) {
  return loadWith("sales:read", async (session) => {
    const q = text(params.q).trim();
    const context = await hubspotContext();
    return {
      q,
      /** A deal whose company is being chosen, kept as context. */
      deal: optionalId(params.deal),
      /** A partner the chosen company will be linked to. */
      partner: optionalGuid(params.partner),
      result: await searchHubSpot(context, q),
      portalId: context.connection.portalId,
      canImport: mayImport(session),
      demo: context.demo,
    };
  });
}

export type OwnerProposal =
  | { kind: "mapped"; ownerId: string; hubspotOwner: string }
  | { kind: "viewer"; ownerId: string; hubspotOwner: string | null }
  | { kind: "none"; hubspotOwner: string | null };

/**
 * The owner a new partner starts with: the staff member an administrator
 * mapped the HubSpot owner to, otherwise the person reviewing, otherwise
 * nobody. The reason is shown beside it.
 */
function proposeOwner(
  context: HubSpotContext,
  hubspotOwner: { id: string; name: string | null } | null,
  owners: readonly PartnerOwnerOption[],
  viewerId: string,
): OwnerProposal {
  const mapped = hubspotOwner
    ? context.connection.ownerMappings.find(
        (row) => row.hubspotOwnerId === hubspotOwner.id,
      )
    : undefined;
  if (mapped && owners.some((owner) => owner.id === mapped.staffId))
    return {
      kind: "mapped",
      ownerId: mapped.staffId,
      hubspotOwner: hubspotOwner?.name ?? hubspotOwner?.id ?? "",
    };
  const hubspotName = hubspotOwner
    ? (hubspotOwner.name ?? hubspotOwner.id)
    : null;
  if (owners.some((owner) => owner.id === viewerId))
    return { kind: "viewer", ownerId: viewerId, hubspotOwner: hubspotName };
  return { kind: "none", hubspotOwner: hubspotName };
}

/**
 * The handoff review. A deal without a chosen company asks for one first;
 * a company already linked opens as an update of its partner; `partner`
 * links an unlinked company to an existing partner.
 */
export function loadReview(params: Params) {
  return loadWith("sales:read", async (session) => {
    const companyId = optionalId(params.company);
    const dealId = optionalId(params.deal);
    const requestedPartner = optionalGuid(params.partner);
    const context = await hubspotContext();
    if (!companyId) {
      if (!dealId) throw new Error("HUBSPOT_RECORD_NOT_FOUND");
      return {
        step: "choose_company" as const,
        choice: await loadDealChoice(context, dealId),
        partner: requestedPartner,
        demo: context.demo,
      };
    }
    const source = await loadHandoffSource(context, { companyId, dealId });
    const linked = (
      await context.store.partnersForCompanies(context.connection.portalId, [
        companyId,
      ])
    ).get(companyId);
    const partnerId = linked?.id ?? requestedPartner;
    const reader = partnerReader(session);
    let destination: PartnerRecord | null = null;
    let history: HubSpotFieldHistory = {};
    let linkedElsewhere: string | null = null;
    if (partnerId) {
      destination = (await reader.get(partnerId, partnerToday())).partner;
      if (!linked) {
        const link = await context.store.linkForPartner(
          partnerId,
          context.connection.portalId,
        );
        linkedElsewhere = link ? link.companyName : null;
      }
      history = await context.store.fieldHistory(partnerId);
    }
    const owners = await reader.owners();
    const host = (() => {
      try {
        return source.proposed.website
          ? new URL(source.proposed.website).hostname
          : source.company.domain || null;
      } catch {
        return null;
      }
    })();
    const suggestions = destination
      ? []
      : (
          await context.store.similarPartners({
            name: source.proposed.name || source.company.name,
            host,
          })
        ).filter((partner) => partner.linkedCompanyId !== companyId);
    return {
      step: "review" as const,
      source,
      connection: {
        id: context.connection.id,
        version: context.connection.version,
      },
      destination,
      /** A different company this partner is already linked to. */
      linkedElsewhere,
      /** The partner page this company is already linked to, if any. */
      alreadyLinked: Boolean(linked),
      /** The person asked for another partner than the linked one. */
      requestedOther: Boolean(
        linked && requestedPartner && requestedPartner !== linked.id,
      ),
      history,
      suggestions,
      owners,
      ownerProposal: proposeOwner(
        context,
        source.company.owner,
        owners,
        session.userId,
      ),
      canImport: mayImport(session),
      demo: context.demo,
    };
  });
}

/** The pipeline, filtered from the URL, with an open deal's people. */
export function loadPipelinePage(params: Params) {
  return loadWith("sales:read", async () => {
    const query = HubSpotPipelineQuerySchema.parse(params);
    const context = await hubspotContext();
    const view = await loadPipeline(context, query);
    const selected = query.deal
      ? (view.deals.find((deal) => deal.id === query.deal) ?? null)
      : null;
    return {
      query,
      view,
      selected,
      people: selected ? await loadDealPeople(context, selected.id) : [],
      portal: context.portal,
      demo: context.demo,
    };
  });
}

/** The administrator's connection page. */
export function loadSettings() {
  return loadWith("staff:manage", async (session) => {
    const demo = explicitDemoIdentityEnabled();
    const store = demo ? null : hubspotRepository();
    const [connection, portalResult] = await Promise.all([
      store
        ? store.connection()
        : Promise.resolve({ active: null, latest: null }),
      configuredPortal().then(
        (portal) => ({ ok: true as const, portal }),
        (error: unknown) => ({
          ok: false as const,
          code:
            error instanceof HubSpotError ? error.code : "HUBSPOT_UNAVAILABLE",
        }),
      ),
    ]);
    const portal = portalResult.ok ? portalResult.portal : null;
    const catalog = portal && !demo ? await settingsCatalog() : null;
    return {
      demo,
      portal,
      portalError: portalResult.ok ? null : portalResult.code,
      active: connection.active,
      latest: connection.latest,
      catalog,
      staff: store ? await partnerRepository().owners() : [],
      canManage: !demo && sessionHas(session, "staff:manage"),
    };
  });
}

/** A partner's import, for the receipt on the partner page. */
export async function loadReceipt(
  partnerId: string,
  importId: string,
): Promise<HubSpotImportRecord | null> {
  if (explicitDemoIdentityEnabled()) return null;
  if (!z.guid().safeParse(importId).success) return null;
  try {
    return await hubspotRepository().import(partnerId, importId);
  } catch (error) {
    if (error instanceof Error && error.message === "HUBSPOT_IMPORT_NOT_FOUND")
      return null;
    throw error;
  }
}

/**
 * The HubSpot parts of a partner page: the section, the receipt named in
 * `?handoff=`, and a registration prepared from `?register=`. A failure here
 * never takes the partner page down with it.
 */
export async function loadPartnerHubSpotParts(
  partner: PartnerRecord,
  params: Params,
) {
  const handoffId = optionalGuid(params.handoff);
  const registerId = optionalGuid(params.register);
  const [view, receipt, register] = await Promise.all([
    loadPartnerHubSpot(partner, null).catch((error: unknown) => {
      console.error("hubspot: partner section failed", error);
      return null;
    }),
    handoffId ? loadReceipt(partner.id, handoffId).catch(() => null) : null,
    registerId && registerId !== handoffId
      ? loadReceipt(partner.id, registerId).catch(() => null)
      : null,
  ]);
  const source = (register ?? receipt)?.plan.deal;
  const dealSuggestion =
    registerId && source
      ? {
          endClient: source.endCustomer?.name ?? "",
          // i18n-exempt: a stored note recording where a registration came from
          notes: `HubSpot deal: ${source.name} (${source.url})`,
        }
      : null;
  return {
    view,
    receipt,
    dealSuggestion,
    autoStart: firstValue(params.start) === "1",
  };
}

const firstValue = (value: unknown) =>
  Array.isArray(value) ? (value as unknown[])[0] : value;

/**
 * MNDA suggestions from a HubSpot import: the partner's name as the
 * proposed company, and the person chosen as primary contact (or the only
 * person brought in) as a proposed signer. A contact is never treated as
 * an authorized signer; the MNDA form asks the seller to confirm.
 */
export async function loadMndaPrefill(rawPartner: unknown, rawImport: unknown) {
  const partnerId = optionalGuid(rawPartner);
  const importId = optionalGuid(rawImport);
  if (!partnerId || !importId) return null;
  try {
    await contractReader("sales:read", getRequestCommerceSession);
    const record = await loadReceipt(partnerId, importId);
    if (!record) return null;
    const { plan } = record;
    const contact =
      plan.contacts.find((c) => c.id === plan.primaryContactId) ??
      (plan.contacts.length === 1 ? plan.contacts[0] : undefined);
    const partner = await partnerRepository().get(partnerId, partnerToday());
    return {
      company: partner.partner.name,
      ...(contact
        ? {
            signerName: contact.name,
            signerEmail: contact.email,
            signerTitle: contact.role,
          }
        : {}),
    };
  } catch (error) {
    console.error("hubspot: MNDA suggestions failed", error);
    return null;
  }
}
