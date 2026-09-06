import type { ChannelPolicySnapshot } from "@clockwork/domain/core";
import { QuantitySchema } from "@clockwork/contracts";

/**
 * An end client the acting partner may name on a deal registration.
 *
 * `deal_registrations.end_client_account_id` is a foreign key onto `accounts`
 * and `loadDealRegistrationContext` reads the row before the domain rule runs,
 * so the end client is always an existing account rather than a name typed into
 * this form. Which accounts appear is decided by row-level security, not by
 * this module: the route reads `accounts` through the tenant pool under the
 * partner's own authorization context, so `core_partner_can_access_account`
 * (supabase/migrations/000934) bounds the list to the accounts an approved
 * registration or an existing partner quote already reaches.
 *
 * The identifier is carried but never rendered as a field. The registrations
 * surface states that it protects opportunities "without exposing raw account
 * identifiers", and a UUID in a text box is exactly the identifier no partner
 * can read anywhere else on the desk.
 */
export interface RegistrableEndClient {
  id: string;
  name: string;
  domain?: string;
  country?: string;
}

/**
 * Everything the form states that the seller did not type.
 *
 * The partner is the acting session's own account, resolved by the route. It is
 * never a form field: `deal_registrations_scope` checks
 * `app_has_account(partner_account_id)` on insert, so a partner identifier that
 * did not come from the session is one the database refuses anyway.
 */
export interface DealRegistrationContext {
  partnerAccountId: string;
  partnerAccountName: string;
  channelPolicy?: ChannelPolicySnapshot;
  endClients: readonly RegistrableEndClient[];
}

export interface DealRegistrationDraft {
  endClientName: string;
  endClientId?: string;
  workload: string;
  expectedVolume: string;
  protectionDays: string;
}

export type DealRegistrationField = keyof DealRegistrationDraft;
export type DealRegistrationValidation = Partial<
  Record<DealRegistrationField, string>
>;

/** The protection window the program guide asks for when none is stated. */
export const defaultProtectionDays = 90;

/**
 * No commercial fact is seeded. The workload and the expected volume are the
 * seller's own claim about the opportunity, and a pre-filled claim is a claim
 * nobody made: the deleted panel branch shipped `Immutable archive` and
 * `120 TB` as defaults, and the second of those could not be submitted at all
 * (see `validateDealRegistration`).
 */
export function emptyDealRegistrationDraft(
  protectionDays = defaultProtectionDays,
): DealRegistrationDraft {
  return {
    endClientName: "",
    workload: "",
    expectedVolume: "",
    protectionDays: String(protectionDays),
  };
}

export function resolveEndClient(
  name: string,
  options: readonly RegistrableEndClient[],
): RegistrableEndClient | undefined {
  const normalized = name.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  const matching = options.filter(
    (option) => option.name.toLocaleLowerCase() === normalized,
  );
  return matching.length === 1 ? matching[0] : undefined;
}

export function resolveRegistrationEndClient(
  draft: DealRegistrationDraft,
  options: readonly RegistrableEndClient[],
): RegistrableEndClient | undefined {
  return draft.endClientId
    ? options.find((option) => option.id === draft.endClientId)
    : resolveEndClient(draft.endClientName, options);
}

/**
 * Every rule here is one the server already enforces, restated where the seller
 * can act on it rather than left to come back as a 500.
 *
 * `expectedVolume` is the one worth naming. The command runs it through
 * `QuantitySchema` -- a bare decimal, no unit -- and the deleted panel branch
 * defaulted the field to the string `120 TB`, which that schema rejects. The
 * schema itself is imported rather than a copy of its pattern, so the form and
 * the command cannot drift apart.
 *
 * `registerDeal` refuses a partner that registers itself, and a protection
 * window that is not a positive whole number of days. A prior deal or a house
 * account is deliberately *not* checked here: those resolve against records
 * this surface cannot see, the server records the exclusion rather than
 * refusing the write, and guessing at the answer locally would block a
 * submission the server would have accepted.
 */
export function validateDealRegistration(
  draft: DealRegistrationDraft,
  context: Pick<
    DealRegistrationContext,
    "partnerAccountId" | "endClients" | "channelPolicy"
  >,
): DealRegistrationValidation {
  const errors: DealRegistrationValidation = {};
  const endClient = resolveRegistrationEndClient(draft, context.endClients);
  if (!endClient)
    errors.endClientName = "Select one of your named end clients by name.";
  else if (endClient.id === context.partnerAccountId)
    errors.endClientName =
      "A partner cannot register itself as its own end client.";
  if (!draft.workload.trim())
    errors.workload = "Describe the workload this opportunity covers.";
  if (!QuantitySchema.safeParse(draft.expectedVolume.trim()).success)
    errors.expectedVolume =
      "Enter the expected volume as a plain number of TB, with no unit.";
  const protectionDays = Number(draft.protectionDays);
  if (!Number.isInteger(protectionDays) || protectionDays < 1)
    errors.protectionDays =
      "Enter a protection window of at least one whole day.";
  if (
    context.channelPolicy?.maximumProtectionDays != null &&
    protectionDays > context.channelPolicy.maximumProtectionDays
  )
    errors.protectionDays = `This policy permits requests of at most ${context.channelPolicy.maximumProtectionDays} days.`;
  return errors;
}

/**
 * The `deal_registrations create` payload.
 *
 * `houseAccountIds` is not sent. The deleted panel branch sent an empty array
 * for it, and the repository ignores the field outright -- "a command caller
 * cannot attest its own exclusion result" -- so sending it implied an attested
 * exclusion check that never happened.
 */
export function dealRegistrationPayload(
  draft: DealRegistrationDraft,
  context: Pick<DealRegistrationContext, "partnerAccountId" | "endClients">,
): {
  partnerAccountId: string;
  endClientAccountId: string;
  workload: string;
  expectedVolume: string;
  protectionDays: number;
} {
  const endClient = resolveRegistrationEndClient(draft, context.endClients);
  if (!endClient)
    throw new Error("The named end client is not one this partner may name.");
  return {
    partnerAccountId: context.partnerAccountId,
    endClientAccountId: endClient.id,
    workload: draft.workload.trim(),
    expectedVolume: draft.expectedVolume.trim(),
    protectionDays: Number(draft.protectionDays),
  };
}

export function dealRegistrationSummary(
  draft: DealRegistrationDraft,
  context: DealRegistrationContext,
): readonly string[] {
  const endClient = resolveRegistrationEndClient(draft, context.endClients);
  return [
    `Registering partner: ${context.partnerAccountName}`,
    `End client: ${endClient?.name ?? "Not selected"}`,
    `Workload: ${draft.workload.trim() || "Not described"}`,
    `Expected volume: ${draft.expectedVolume.trim() ? `${draft.expectedVolume.trim()} TB` : "Not stated"}`,
    `Protection requested: ${draft.protectionDays || "0"} days from registration, subject to approval`,
  ];
}
