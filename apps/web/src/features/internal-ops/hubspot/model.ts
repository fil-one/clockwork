import type { Route } from "next";

import {
  hubspotErrorCodes,
  hubspotPipelineSearchParams,
  type HubSpotCompanyReference,
  type HubSpotDealReference,
  type HubSpotFile,
  type HubSpotFieldDrift,
  type HubSpotImportStatus,
  type HubSpotItemStatus,
  type HubSpotNoteReference,
  type HubSpotPipelineQuery,
  type HubSpotSourceValue,
} from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

/**
 * Everything a handoff review shows about the HubSpot side, read fresh
 * through the approved scope. `digests` fingerprint each item as shown, so
 * the commit can tell whether anything selected changed in the meantime.
 */
export interface HandoffSource {
  portal: { portalId: string; uiDomain: string };
  retrievedAt: string;
  company: {
    id: string;
    url: string;
    name: string;
    domain: string;
    /** HubSpot's own website value, before normalization. */
    website: string | null;
    country: string | null;
    updatedAt: string | null;
    owner: { id: string; name: string | null } | null;
  };
  /** Proposed Commerce values after the bounded normalization. */
  proposed: { name: string; website: string; region: string };
  /** Approved additional properties, with their labels and types. */
  companyValues: readonly HubSpotSourceValue[];
  deal: {
    reference: Omit<HubSpotDealReference, "chosenCompanyId" | "endCustomer">;
    values: readonly HubSpotSourceValue[];
  } | null;
  contacts: readonly {
    id: string;
    name: string;
    email: string;
    role: string;
    labels: readonly string[];
  }[];
  /** `null` when notes are outside the approved scope. */
  notes: readonly HubSpotNoteReference[] | null;
  /** `null` when files are outside the approved scope. */
  files: readonly HubSpotFile[] | null;
  digests: Readonly<Record<string, string>>;
}

/** A deal's companies, for choosing which one becomes the partner. */
export interface DealCompanyChoice {
  deal: {
    id: string;
    name: string;
    url: string;
    stageLabel: string | null;
  };
  companies: readonly (HubSpotCompanyReference & {
    partner: { id: string; name: string } | null;
  })[];
}

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const importStatusLabels: Readonly<
  Record<HubSpotImportStatus, MessageId>
> = {
  complete: "operations.hubspot.import.status.complete",
  needs_attention: "operations.hubspot.import.status.needs_attention",
  completed_with_exclusions:
    "operations.hubspot.import.status.completed_with_exclusions",
};

export const importStatusTone: Readonly<Record<HubSpotImportStatus, Tone>> = {
  complete: "success",
  needs_attention: "warning",
  completed_with_exclusions: "info",
};

export const itemStatusLabels: Readonly<Record<HubSpotItemStatus, MessageId>> =
  {
    pending: "operations.hubspot.item.status.pending",
    attached: "operations.hubspot.item.status.attached",
    failed: "operations.hubspot.item.status.failed",
    duplicate: "operations.hubspot.item.status.duplicate",
    reused: "operations.hubspot.item.status.reused",
    excluded: "operations.hubspot.item.status.excluded",
  };

export const itemStatusTone: Readonly<Record<HubSpotItemStatus, Tone>> = {
  pending: "neutral",
  attached: "success",
  failed: "danger",
  duplicate: "warning",
  reused: "success",
  excluded: "neutral",
};

export const driftLabels: Readonly<Record<HubSpotFieldDrift, MessageId>> = {
  never_imported: "operations.hubspot.drift.never_imported",
  unchanged: "operations.hubspot.drift.unchanged",
  hubspot_changed: "operations.hubspot.drift.hubspot_changed",
  commerce_changed: "operations.hubspot.drift.commerce_changed",
  both_changed: "operations.hubspot.drift.both_changed",
};

const otherErrors = [
  "INVALID_INPUT",
  "CONTRACT_FORBIDDEN",
  "CONTRACT_MFA_REQUIRED",
  "CONTRACT_DEMO_UNAVAILABLE",
  "SESSION_EXPIRED",
  "PARTNER_VERSION_CONFLICT",
  "PARTNER_NOT_FOUND",
  "PARTNER_OWNER_NOT_STAFF",
  "HUBSPOT_OWNER_NOT_STAFF",
  "UNEXPECTED",
] as const;
type HubSpotMessageCode =
  (typeof hubspotErrorCodes)[number] | (typeof otherErrors)[number];

const errorMessages = Object.fromEntries(
  [...hubspotErrorCodes, ...otherErrors].map((code) => [
    code,
    `operations.hubspot.error.${code}`,
  ]),
) as Record<HubSpotMessageCode, MessageId>;

/** The message for a refusal; unknown codes read as unexpected. */
export function hubspotErrorMessage(code: string): MessageId {
  return errorMessages[code as HubSpotMessageCode] ?? errorMessages.UNEXPECTED;
}

export const hubspotPickerPath = "/internal/hubspot" as Route;
export const pipelinePath = "/internal/pipeline" as Route;
export const hubspotSettingsPath = "/internal/owner/hubspot" as Route;

/** The review for a company, optionally from a deal or into a partner. */
export function handoffHref(input: {
  company?: string;
  deal?: string | null;
  partner?: string | null;
}): Route {
  const params = new URLSearchParams();
  if (input.company) params.set("company", input.company);
  if (input.deal) params.set("deal", input.deal);
  if (input.partner) params.set("partner", input.partner);
  return `/internal/hubspot/review?${params.toString()}` as Route;
}

export function pipelineHref(query: Partial<HubSpotPipelineQuery>): Route {
  const search = hubspotPipelineSearchParams(query).toString();
  return search ? `${pipelinePath}?${search}` : pipelinePath;
}

/** A partner page with this import's receipt open. */
export function receiptHref(
  partnerId: string,
  importId: string,
  options: { start?: boolean } = {},
): Route {
  return `/internal/partners/${partnerId}?handoff=${importId}${options.start ? "&start=1" : ""}#hubspot-receipt` as Route;
}

/** Whole-number and decimal amounts as money in their own currency. */
export function formatHubSpotAmount(
  amount: string,
  currency: string,
  locale: string,
): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** A HubSpot close date is an instant; show the calendar day it names. */
export function formatHubSpotDate(value: string | null, locale: string) {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(time);
}
