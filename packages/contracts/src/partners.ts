import { z } from "zod";

/**
 * The staff partner record: what the revenue team agreed, or is negotiating,
 * with a channel, referral or technology partner, kept before any
 * organization exists in Commerce. It is a working record for sellers and is
 * not read by billing, commissions or the partner portal (docs/operations/
 * partner-records.md).
 */
export const partnerModels = [
  "referral",
  "resale",
  "affiliate",
  "distributor",
  "msp",
  "teaming",
  "technology",
  "other",
] as const;
export type PartnerModel = (typeof partnerModels)[number];

export const partnerStatuses = [
  "prospect",
  "talking",
  "negotiating",
  "terms_agreed",
  "signed",
  "active",
  "paused",
  "ended",
] as const;
export type PartnerStatus = (typeof partnerStatuses)[number];

export const partnerExclusivity = ["none", "limited", "exclusive"] as const;
export type PartnerExclusivity = (typeof partnerExclusivity)[number];

export const partnerCurrencies = ["USD", "EUR", "GBP"] as const;
export type PartnerCurrency = (typeof partnerCurrencies)[number];

export const partnerDealStatuses = [
  "registered",
  "accepted",
  "won",
  "lost",
  "expired",
  "withdrawn",
  "disputed",
] as const;
export type PartnerDealStatus = (typeof partnerDealStatuses)[number];

/** A registration still claims its end client while protection lasts. */
export const openPartnerDealStatuses = [
  "registered",
  "accepted",
  "disputed",
] as const satisfies readonly PartnerDealStatus[];
/** Registrations that lapse to `expired` once protection ends. */
export const expiringPartnerDealStatuses = [
  "registered",
  "accepted",
] as const satisfies readonly PartnerDealStatus[];

export const partnerDealModels = ["referral", "resale", "other"] as const;
export type PartnerDealModel = (typeof partnerDealModels)[number];

export const partnerSizeUnits = ["TB", "PB", "TiB", "PiB"] as const;
export type PartnerSizeUnit = (typeof partnerSizeUnits)[number];

/** Protection when no channel policy is in force (the policy's own default). */
export const partnerDefaultProtectionDays = 90;
export const partnerListLimit = 500;
export const partnerExportLimit = 5000;
export const partnerContactLimit = 20;
export const partnerTermRowLimit = 40;
export const partnerStepLimit = 24;

const noControl = (value: string) =>
  [...value].every((c) => {
    const code = c.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
const line = (max: number) =>
  z.string().trim().min(1).max(max).refine(noControl, "control_character");
const optionalLine = (max: number) =>
  z.string().trim().max(max).refine(noControl, "control_character").default("");
// Multi-line text keeps newlines and tabs but no other control characters.
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) =>
        [...value].every((c) => {
          const code = c.charCodeAt(0);
          return code >= 32 || code === 9 || code === 10 || code === 13;
        }),
      "control_character",
    )
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .default("");

/** One spelling per number: "017.50" and "17.5" are both "17.5". */
function canonicalDecimal(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const integer = whole.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  return decimals ? `${integer}.${decimals}` : integer;
}

/**
 * A percentage from 0 to 100 with up to four decimals, as typed ("17.5",
 * "32"). Sanity bounds only: no commission or margin ceiling applies here.
 */
export const partnerPercentSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/%$/, "").trim())
  .pipe(
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,4})?$/, "percent_format")
      .refine((value) => Number(value) <= 100, "percent_range"),
  )
  .transform(canonicalDecimal);
// An empty field is no rate; anything else must be a rate, so its own refusal
// (format or range) reaches the form.
const percent = z
  .preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    partnerPercentSchema.nullable(),
  )
  .default(null);

/** A positive size with up to three decimals ("250", "1.5"). */
export const partnerSizeSchema = z
  .string()
  .trim()
  .transform((value) => value.replaceAll(",", ""))
  .pipe(
    z
      .string()
      .regex(/^\d{1,12}(\.\d{1,3})?$/, "size_format")
      .refine((value) => Number(value) > 0, "size_range"),
  )
  .transform(canonicalDecimal);

// A calendar day this century, so protection arithmetic stays in range.
const isoDate = z.iso
  .date()
  .refine(
    (value) => value >= "2000-01-01" && value <= "2099-12-31",
    "date_range",
  );
const optionalDate = z
  .union([isoDate, z.literal(""), z.null()])
  .transform((value) => (value ? value : null))
  .default(null);
const optionalId = z
  .union([z.guid(), z.literal(""), z.null()])
  .transform((value) => (value ? value : null))
  .default(null);

export const PartnerContactSchema = z
  .object({
    name: line(200),
    email: z
      .union([z.email().max(320), z.literal("")])
      .transform((value) => value.trim().toLowerCase())
      .default(""),
    role: optionalLine(200),
  })
  .strict();
export type PartnerContact = z.infer<typeof PartnerContactSchema>;

/** One free-form term: what was agreed, in the words of the deal. */
export const PartnerTermRowSchema = z
  .object({
    label: line(120),
    value: line(500),
    notes: optionalLine(1000),
  })
  .strict();
export type PartnerTermRow = z.infer<typeof PartnerTermRowSchema>;

/** One step of a commission schedule: the rate from a month of the term. */
export const PartnerCommissionStepSchema = z
  .object({
    fromMonth: z.coerce.number().int().min(1).max(600),
    ratePct: partnerPercentSchema,
  })
  .strict();
export type PartnerCommissionStep = z.infer<typeof PartnerCommissionStepSchema>;

/**
 * The common terms, each optional, beside the free-form rows. Anything the
 * slots do not fit goes in a row.
 */
export const PartnerTermsSchema = z
  .object({
    commissionPct: percent,
    /** Duration or step-down in words ("36 months, stepping down yearly"). */
    commissionSchedule: optionalLine(500),
    commissionSteps: z
      .array(PartnerCommissionStepSchema)
      .max(partnerStepLimit)
      .default([])
      .refine(
        (steps) =>
          steps.every(
            (step, index) =>
              index === 0 ||
              step.fromMonth > (steps[index - 1]?.fromMonth ?? 0),
          ),
        "steps_order",
      ),
    marginPct: percent,
    territory: optionalLine(500),
    exclusivity: z
      .union([z.enum(partnerExclusivity), z.literal(""), z.null()])
      .transform((value) => (value ? value : null))
      .default(null),
    exclusivityNote: optionalLine(500),
    currency: z
      .union([z.enum(partnerCurrencies), z.literal(""), z.null()])
      .transform((value) => (value ? value : null))
      .default(null),
    nfrAllowance: optionalLine(500),
    trialPeriod: optionalLine(200),
    trialTargets: text(2000),
    rows: z.array(PartnerTermRowSchema).max(partnerTermRowLimit).default([]),
  })
  .strict();
export type PartnerTerms = z.infer<typeof PartnerTermsSchema>;

/** A new partner, or an overwrite of `id` when `expectedVersion` is given. */
export const PartnerInputSchema = z
  .object({
    id: z.uuid(),
    expectedVersion: z.int().min(1).optional(),
    name: line(200),
    website: optionalLine(500),
    region: optionalLine(500),
    models: z
      .array(z.enum(partnerModels))
      .max(partnerModels.length)
      .default([])
      .transform((models) =>
        partnerModels.filter((model) => models.includes(model)),
      ),
    status: z.enum(partnerStatuses).default("prospect"),
    /** A staff member; empty leaves the partner unowned. */
    ownerId: optionalId,
    organizationId: optionalId,
    contacts: z
      .array(PartnerContactSchema)
      .max(partnerContactLimit)
      .default([]),
    nextStep: optionalLine(500),
    nextStepDue: optionalDate,
    notes: text(8000),
    terms: PartnerTermsSchema.default(PartnerTermsSchema.parse({})),
  })
  .strict();
export type PartnerInput = z.infer<typeof PartnerInputSchema>;

/** A registered deal, new or an overwrite when `expectedVersion` is given. */
export const PartnerDealInputSchema = z
  .object({
    id: z.uuid(),
    partnerId: z.guid(),
    expectedVersion: z.int().min(1).optional(),
    endClient: line(200),
    organizationId: optionalId,
    registeredOn: isoDate,
    /** Empty takes the channel policy's protection from `registeredOn`. */
    protectedUntil: optionalDate,
    estimatedSize: z
      .preprocess(
        (value) =>
          typeof value === "string" && value.trim() === "" ? null : value,
        partnerSizeSchema.nullable(),
      )
      .default(null),
    sizeUnit: z
      .union([z.enum(partnerSizeUnits), z.literal(""), z.null()])
      .transform((value) => (value ? value : null))
      .default(null),
    model: z.enum(partnerDealModels).default("referral"),
    status: z.enum(partnerDealStatuses).default("registered"),
    notes: text(4000),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.estimatedSize !== null && input.sizeUnit === null)
      ctx.addIssue({
        code: "custom",
        path: ["sizeUnit"],
        message: "size_unit_required",
      });
    if (
      input.protectedUntil !== null &&
      input.protectedUntil < input.registeredOn
    )
      ctx.addIssue({
        code: "custom",
        path: ["protectedUntil"],
        message: "protection_before_registration",
      });
  });
export type PartnerDealInput = z.infer<typeof PartnerDealInputSchema>;

const firstValue = (value: unknown): unknown =>
  Array.isArray(value)
    ? (value as unknown[])[0]
    : value === ""
      ? undefined
      : value;

export const partnerDueFilters = ["overdue", "week"] as const;
export type PartnerDueFilter = (typeof partnerDueFilters)[number];

/** List filters, read from URL search parameters. Unknown values fall back
 * to no filter rather than failing the page. */
export const PartnerListQuerySchema = z.object({
  q: z.preprocess(firstValue, z.string().trim().max(100).catch("")).default(""),
  status: z.preprocess(
    firstValue,
    z.enum(partnerStatuses).optional().catch(undefined),
  ),
  model: z.preprocess(
    firstValue,
    z.enum(partnerModels).optional().catch(undefined),
  ),
  owner: z.preprocess(firstValue, z.guid().optional().catch(undefined)),
  /** Only partners the reader owns. */
  mine: z.preprocess((value) => firstValue(value) === "1", z.boolean()),
  /** Next steps past due, or due within seven days (overdue included). */
  due: z.preprocess(
    firstValue,
    z.enum(partnerDueFilters).optional().catch(undefined),
  ),
});
export type PartnerListQuery = z.infer<typeof PartnerListQuerySchema>;

/** The query string a list view or export link carries. */
export function partnerListSearchParams(
  query: Partial<PartnerListQuery>,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.model) params.set("model", query.model);
  if (query.owner) params.set("owner", query.owner);
  if (query.mine) params.set("mine", "1");
  if (query.due) params.set("due", query.due);
  return params;
}

export interface PartnerRecord {
  id: string;
  name: string;
  website: string;
  region: string;
  models: PartnerModel[];
  status: PartnerStatus;
  ownerId: string | null;
  ownerName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  contacts: PartnerContact[];
  nextStep: string;
  nextStepDue: string | null;
  notes: string;
  terms: PartnerTerms;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A list row: the record without its long text, plus deal counts. */
export interface PartnerSummary {
  id: string;
  name: string;
  region: string;
  models: PartnerModel[];
  status: PartnerStatus;
  ownerId: string | null;
  ownerName: string | null;
  nextStep: string;
  nextStepDue: string | null;
  commissionPct: string | null;
  marginPct: string | null;
  currency: PartnerCurrency | null;
  openDeals: number;
  updatedAt: string;
}

export interface PartnerDealRecord {
  id: string;
  partnerId: string;
  endClient: string;
  organizationId: string | null;
  organizationName: string | null;
  registeredOn: string;
  protectedUntil: string;
  estimatedSize: string | null;
  sizeUnit: PartnerSizeUnit | null;
  model: PartnerDealModel;
  status: PartnerDealStatus;
  notes: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Another partner's open registration for the same end client. */
export interface PartnerDealConflict {
  dealId: string;
  partnerId: string;
  partnerName: string;
  endClient: string;
  status: PartnerDealStatus;
  registeredOn: string;
  protectedUntil: string;
}

export interface PartnerDealWithConflicts extends PartnerDealRecord {
  conflicts: PartnerDealConflict[];
}

/** One change in a partner's history, from the audit trail. */
export interface PartnerActivity {
  id: string;
  eventType: string;
  actorName: string;
  /** The end client, for a change to a registered deal. */
  dealEndClient: string | null;
  /** Field names changed, with the values before and after. */
  changes: Record<string, { from: unknown; to: unknown }>;
  occurredAt: string;
}

/** A partner whose next step is due on or before a day, for the home page
 * and for reminders. */
export interface PartnerNextStepDue {
  partnerId: string;
  partnerName: string;
  ownerId: string | null;
  ownerName: string | null;
  nextStep: string;
  nextStepDue: string;
  overdue: boolean;
}

/** Someone a partner can be assigned to. */
export interface PartnerOwnerOption {
  id: string;
  name: string;
}
export interface PartnerOrganizationOption {
  id: string;
  name: string;
  side: string;
}

/** Refusals a partner action can return; the page words each one. */
export const partnerErrorCodes = [
  "PARTNER_NOT_FOUND",
  "PARTNER_VERSION_CONFLICT",
  "PARTNER_IDEMPOTENCY_CONFLICT",
  "PARTNER_DEAL_IDEMPOTENCY_CONFLICT",
  "PARTNER_OWNER_NOT_STAFF",
  "PARTNER_ORGANIZATION_NOT_FOUND",
  "PARTNER_DEAL_NOT_FOUND",
  "PARTNER_DEAL_VERSION_CONFLICT",
  "PARTNER_DEAL_PARTNER_MISMATCH",
  "PARTNER_UNAVAILABLE",
] as const;
export type PartnerErrorCode = (typeof partnerErrorCodes)[number];

/** The day `days` after an ISO date, in UTC. */
export function addPartnerDays(isoDate: string, days: number): string {
  const time = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** A stored decimal without trailing zeros: "17.5000" reads "17.5". */
export function trimPartnerDecimal(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** Whether a registration still claims its end client on `today`. */
export function partnerDealIsOpen(
  deal: Pick<PartnerDealRecord, "status" | "protectedUntil">,
  today: string,
): boolean {
  return (
    (openPartnerDealStatuses as readonly string[]).includes(deal.status) &&
    deal.protectedUntil >= today
  );
}
