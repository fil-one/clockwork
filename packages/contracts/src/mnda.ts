import { z } from "zod";

/** Characters the agreement font prints: the WinAnsi set the template was
 * reviewed with, plus Latin Extended-A/B and Latin Extended Additional. */
const printable =
  /^[\u0020-\u007e\u00a0-\u00ff\u0100-\u024f\u1e00-\u1eff\u02c6\u02dc\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac]+$/u;
const label = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (value) =>
      [...value].every((c) => c.charCodeAt(0) >= 32 && !"<>[]{}".includes(c)),
    { params: { mnda: "reserved_characters" } },
  )
  // The approved English template is printed in a Latin-script font. Fail
  // rather than silently dropping glyphs in a legal entity name or address.
  .regex(printable);
const optionalLabel = z
  .string()
  .trim()
  .pipe(z.union([label, z.literal("")]))
  .default("");
export const MndaSignerSchema = z
  .object({
    id: z.uuid(),
    name: label,
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    title: label,
    active: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
export type MndaSigner = z.infer<typeof MndaSignerSchema>;
export const MndaInputSchema = z
  .object({
    id: z.uuid(),
    detailsMode: z.enum(["team", "recipient", "mixed"]).optional(),
    company: label,
    shortName: optionalLabel,
    entityDescription: optionalLabel,
    streetAddress: optionalLabel,
    locality: optionalLabel,
    noticesContact: optionalLabel,
    noticesEmail: z
      .union([z.email().max(254), z.literal("")])
      .default("")
      .transform((v) => v.toLowerCase()),
    signerName: label,
    signerEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    signerTitle: optionalLabel,
    countersignerId: z.uuid(),
    effectiveDate: z.iso.date(),
  })
  .strict()
  .transform((input) => ({
    ...input,
    shortName:
      input.detailsMode === "recipient"
        ? input.shortName
        : input.shortName || input.company,
  }))
  .superRefine((input, ctx) => {
    if (!input.detailsMode || input.detailsMode === "team") {
      for (const key of [
        "shortName",
        "entityDescription",
        "streetAddress",
        "locality",
        "noticesContact",
        "noticesEmail",
        "signerTitle",
      ] as const)
        if (!input[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required when our team supplies partner details",
          });
    }
  });
/**
 * A new draft names the partner's legal company. The retired "partner
 * completes details" mode put an internal reference in that field, which then
 * named the counterparty in the contract register; drafts already in that mode
 * still parse with `MndaInputSchema`, render, send and sync.
 */
export const MndaDraftInputSchema = MndaInputSchema.superRefine(
  (input, ctx) => {
    if (input.detailsMode === "recipient")
      ctx.addIssue({
        code: "invalid_value",
        values: ["mixed", "team"],
        input: input.detailsMode,
        path: ["detailsMode"],
        message: "Partner-completed drafts are retired",
      });
  },
);
export const mndaRecipientFields = [
  { id: "company_intro", label: "Legal company name" },
  { id: "entity", label: "Jurisdiction and entity type" },
  { id: "email_intro", label: "Notice email", email: true },
  { id: "address_intro", label: "Full notice address" },
  { id: "short_name", label: "Company short name" },
  { id: "company_sign", label: "Legal company name" },
  { id: "signer_name", label: "Authorized signer full name" },
  { id: "signer_title", label: "Authorized signer title" },
  { id: "company_notice", label: "Legal company name" },
  { id: "notice_contact", label: "Notice contact name" },
  { id: "address_notice", label: "Full notice address" },
  { id: "email_notice", label: "Notice email", email: true },
] as const;
export type MndaInput = z.infer<typeof MndaInputSchema>;

const mixedAddressFields = [
  { id: "street_intro", label: "Street address" },
  { id: "locality_intro", label: "City, region, postal code, country" },
  { id: "street_notice", label: "Street address" },
  { id: "locality_notice", label: "City, region, postal code, country" },
] as const;
export const mndaDetailFields = [...mndaRecipientFields, ...mixedAddressFields];
export type MndaDetailFieldId = (typeof mndaDetailFields)[number]["id"];

/** A supplied value is printed in the agreement; only a missing value becomes
 * a required recipient field. Legacy recipient-only drafts keep their tags. */
export function mndaDetailValue(
  input: MndaInput,
  id: MndaDetailFieldId,
): string {
  const values: Record<MndaDetailFieldId, string> = {
    company_intro: input.company,
    company_sign: input.company,
    company_notice: input.company,
    entity: input.entityDescription,
    email_intro: input.noticesEmail,
    email_notice: input.noticesEmail,
    address_intro: [input.streetAddress, input.locality]
      .filter(Boolean)
      .join(", "),
    address_notice: [input.streetAddress, input.locality]
      .filter(Boolean)
      .join(", "),
    street_intro: input.streetAddress,
    street_notice: input.streetAddress,
    locality_intro: input.locality,
    locality_notice: input.locality,
    short_name: input.shortName || input.company,
    signer_name: input.signerName,
    signer_title: input.signerTitle,
    notice_contact: input.noticesContact,
  };
  return values[id];
}

export function mndaSigningFields(input: MndaInput) {
  if (input.detailsMode === "recipient") return [...mndaRecipientFields];
  if (input.detailsMode !== "mixed") return [];
  return mndaDetailFields.filter(
    ({ id }) =>
      id !== "address_intro" &&
      id !== "address_notice" &&
      !mndaDetailValue(input, id),
  );
}
export const mndaStates = [
  "draft",
  "preparing",
  "ready",
  "sending",
  "sent",
  "viewed",
  "awaiting_countersignature",
  "completed",
  "declined",
  "expired",
  "canceled",
  "attention",
] as const;
export type MndaState = (typeof mndaStates)[number];
export interface MndaRecord {
  id: string;
  input: MndaInput;
  countersigner: MndaSigner;
  /** Fil One notice email printed in the agreement, snapshotted at drafting.
   * Null on drafts made before the setting existed; those printed the
   * countersigner's email. Use `mndaNoticeEmail`. */
  noticeEmail: string | null;
  ownerId: string;
  ownerName: string;
  /** Copied on the completed agreement. Null on drafts made before it was kept. */
  ownerEmail: string | null;
  /** Replaces the partner signer's email after a bounce or typo. */
  correctedSignerEmail: string | null;
  /** Sent to SignWell but not yet confirmed by a refresh. */
  pendingSignerEmail: string | null;
  state: MndaState;
  providerId: string | null;
  testMode: boolean;
  templateHash: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  remindedAt: string | null;
  completedAt: string | null;
  /** Why the request closed; translated by the interface. */
  cancelCode: MndaCancelCode | null;
  /** Typed by the person who voided it. */
  cancelReason: string | null;
  error: string | null;
  version: number;
}

/** Register filters, named for what the seller is waiting on. The URL carries
 * the underlying state names (`?status=sent,viewed`). */
export const mndaStatusGroups = {
  drafts: ["draft", "preparing", "ready", "sending"],
  waiting_partner: ["sent", "viewed"],
  waiting_fil_one: ["awaiting_countersignature"],
  attention: ["attention"],
  completed: ["completed"],
  closed: ["declined", "expired", "canceled"],
} as const satisfies Record<string, readonly MndaState[]>;
export type MndaStatusGroup = keyof typeof mndaStatusGroups;
export const mndaOpenStates: readonly MndaState[] = [
  "sent",
  "viewed",
  "awaiting_countersignature",
  "attention",
];

/** Register exports stop at this many rows. */
export const mndaExportLimit = 10_000;
export const mndaRegisterPageSizes = [25, 50, 100] as const;
export const MndaRegisterQuerySchema = z
  .object({
    status: z.array(z.enum(mndaStates)).max(mndaStates.length).default([]),
    mine: z.boolean().default(false),
    q: z.string().trim().max(120).default(""),
    page: z.number().int().min(1).max(100_000).default(1),
    pageSize: z
      .union(mndaRegisterPageSizes.map((size) => z.literal(size)))
      .default(25),
  })
  .strict();
export type MndaRegisterQuery = z.infer<typeof MndaRegisterQuerySchema>;

type SearchParamSource =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;
function firstParam(source: SearchParamSource, key: string) {
  if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
  const value = source[key];
  return typeof value === "string" ? value : value?.[0];
}
/** Lenient: unknown states and malformed numbers are dropped, never fatal, so
 * a stale bookmark still opens the register. */
export function parseMndaRegisterParams(
  source: SearchParamSource,
): MndaRegisterQuery {
  const states = new Set<string>(mndaStates);
  const status = [
    ...new Set(
      (firstParam(source, "status") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => states.has(value)),
    ),
  ] as MndaState[];
  const page = Number.parseInt(firstParam(source, "page") ?? "", 10);
  const pageSize = Number.parseInt(firstParam(source, "size") ?? "", 10);
  return MndaRegisterQuerySchema.parse({
    status,
    mine: firstParam(source, "mine") === "1",
    q: (firstParam(source, "q") ?? "").trim().slice(0, 120),
    page: Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 100_000) : 1,
    pageSize: (mndaRegisterPageSizes as readonly number[]).includes(pageSize)
      ? pageSize
      : 25,
  });
}
export function mndaRegisterSearchParams(
  query: Partial<MndaRegisterQuery>,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status?.length) params.set("status", query.status.join(","));
  if (query.mine) params.set("mine", "1");
  if (query.q) params.set("q", query.q);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.pageSize && query.pageSize !== 25)
    params.set("size", String(query.pageSize));
  return params;
}
export interface MndaRegisterPage {
  records: MndaRecord[];
  total: number;
  page: number;
  pageSize: number;
}
export type MndaStateCounts = Record<MndaState, number>;

export const defaultMndaNoticeEmail = "james@fil.one";
export const MndaSettingsSchema = z
  .object({
    noticeEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
  })
  .strict();
export type MndaSettingsInput = z.infer<typeof MndaSettingsSchema>;
export interface MndaSettings extends MndaSettingsInput {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const mndaCancelCodes = [
  "superseded",
  "discarded",
  "voided",
  "signer_change",
] as const;
export type MndaCancelCode = (typeof mndaCancelCodes)[number];
/** Voiding needs a typed reason, or the "a different person will sign"
 * code, which every reader sees in their own language. */
export const MndaVoidSchema = z.union([
  z
    .object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) })
    .strict(),
  z.object({ id: z.uuid(), code: z.literal("signer_change") }).strict(),
]);
/** A sent request can be voided until the partner has signed. */
export const mndaVoidableStates: readonly MndaState[] = [
  "draft",
  "preparing",
  "ready",
  "sent",
  "viewed",
  "attention",
];
export const MndaCorrectSignerSchema = z
  .object({
    id: z.uuid(),
    signerEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
  })
  .strict();

/** Stable codes the workspace maps to specific, translated messages. */
export const mndaErrorCodes = [
  "required",
  "invalid_characters",
  "invalid_email",
  "too_long",
  "invalid_date",
  "invalid_value",
  "same_as_countersigner",
  "countersigner_unavailable",
  "reminder_cooldown",
  "busy",
  "provider_failed",
  "forbidden",
  "mfa_required",
  "not_configured",
  "not_found",
  "conflict",
  "settings_changed",
  "settings_conflict",
  "not_owner",
  "not_voidable",
  "not_pending",
  "signer_started",
  "not_correctable",
  "already_completed",
  "needs_attention",
  "reason_required",
  "session_expired",
  "unexpected",
] as const;
export type MndaErrorCode = (typeof mndaErrorCodes)[number];
export interface MndaFieldError {
  field: string;
  code: MndaErrorCode;
}
export type MndaResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: MndaErrorCode; fields?: MndaFieldError[] };

/** Why a request needs a person, kept in `MndaRecord.error`. */
export const mndaAttentionReasons = [
  "provider_unavailable",
  "recipient_bounced",
  "provider_stopped",
  "deleted_in_signwell",
  // SignWell's copy names other signers, or is not bound to this request.
  "signwell_signers_mismatch",
  "signwell_binding_mismatch",
] as const;
export type MndaAttentionReason = (typeof mndaAttentionReasons)[number];

export function mndaSignerEmail(record: MndaRecord): string {
  return record.correctedSignerEmail ?? record.input.signerEmail;
}
export function mndaNoticeEmail(record: MndaRecord): string {
  return record.noticeEmail ?? record.countersigner.email;
}
