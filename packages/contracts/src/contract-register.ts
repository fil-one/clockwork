import { z } from "zod";

/**
 * The staff contract register: executed and in-flight agreements with
 * prospects, customers and partners, recorded without a commerce account.
 * The lifecycle `agreements` model stays the long-term home once accounts
 * exist; nothing here writes to it.
 */
export const contractTypes = [
  "mnda",
  "nda_one_way",
  "customer_msa",
  "order_form",
  "dpa",
  "security_annex",
  "channel_partnership",
  "technology_partner",
  "sow",
  "other",
] as const;
export type ContractType = (typeof contractTypes)[number];

export const contractPapers = ["ours", "theirs"] as const;
export type ContractPaper = (typeof contractPapers)[number];

export const contractStatuses = [
  "draft",
  "in_negotiation",
  "out_for_signature",
  "executed",
  "expired",
  "terminated",
] as const;
export type ContractStatus = (typeof contractStatuses)[number];

/** What a stored file is to its contract. `generated` and `executed` are
 * written only by the signing engine and are never removable. */
export const contractFileKinds = [
  "main",
  "attachment",
  "counterparty_draft",
  "redline",
  "generated",
  "executed",
] as const;
export type ContractFileKind = (typeof contractFileKinds)[number];
export const uploadableContractFileKinds = [
  "main",
  "attachment",
  "counterparty_draft",
  "redline",
] as const satisfies readonly ContractFileKind[];
export type UploadableContractFileKind =
  (typeof uploadableContractFileKinds)[number];

export const contractCurrencies = ["USD", "EUR", "GBP"] as const;
export type ContractCurrency = (typeof contractCurrencies)[number];

/** One PDF, at most 25 MiB, per stored document. */
export const contractDocumentMaxBytes = 25 * 1024 * 1024;
export const contractDocumentContentType = "application/pdf";

const noControl = (value: string) =>
  [...value].every((c) => {
    const code = c.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
const line = (max: number) =>
  z.string().trim().min(1).max(max).refine(noControl, "control_character");
const optionalLine = (max: number) =>
  z.string().trim().max(max).refine(noControl, "control_character").default("");
// Multi-line notes keep newlines and tabs but no other control characters.
const notes = (max: number) =>
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
const tag = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} &/._+-]*$/u, "tag_characters")
  .transform((value) => value.toLowerCase().replace(/\s+/g, " "));
const months = z.number().int().min(1).max(600);

/** Decimal text such as "12000" or "12,000.50", in major units. */
export const contractValueTextSchema = z
  .string()
  .trim()
  .transform((value) => value.replaceAll(",", ""))
  .pipe(z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "value_format"));

export function contractValueToMinor(text: string): number {
  const [whole = "0", fraction = ""] = contractValueTextSchema
    .parse(text)
    .split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export const ContractInputSchema = z
  .object({
    id: z.uuid(),
    counterpartyName: line(200),
    title: optionalLine(200),
    contractType: z.enum(contractTypes),
    paper: z.enum(contractPapers),
    status: z.enum(contractStatuses),
    effectiveDate: z.iso.date().nullable(),
    initialTermMonths: months.nullable(),
    autoRenew: z.boolean(),
    renewalTermMonths: months.nullable(),
    noticePeriodDays: z.number().int().min(0).max(3650).nullable(),
    valueMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    currency: z.enum(contractCurrencies).nullable(),
    pricingNotes: notes(2000),
    ownerName: line(120),
    internalNotes: notes(10_000),
    tags: z
      .array(tag)
      .max(20)
      .default([])
      .transform((tags) => [...new Set(tags)]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.autoRenew) {
      for (const key of [
        "effectiveDate",
        "initialTermMonths",
        "renewalTermMonths",
      ] as const)
        if (input[key] === null)
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required_for_auto_renew",
          });
    }
    if (input.initialTermMonths !== null && input.effectiveDate === null)
      ctx.addIssue({
        code: "custom",
        path: ["effectiveDate"],
        message: "required_for_term",
      });
    if ((input.valueMinor === null) !== (input.currency === null))
      ctx.addIssue({
        code: "custom",
        path: [input.valueMinor === null ? "valueMinor" : "currency"],
        message: "value_and_currency",
      });
  });
export type ContractInput = z.infer<typeof ContractInputSchema>;

export const ContractUpdateSchema = z
  .object({ expectedVersion: z.number().int().min(1), contract: z.unknown() })
  .strict();

/** The dates that follow from a contract's term, as of one calendar day. */
export interface ContractTermSchedule {
  /** Last day of the current term. */
  termEndDate: string | null;
  /** First day of the next term; only for contracts that renew themselves. */
  renewalDate: string | null;
  /** Last day to give notice of non-renewal for the next renewal. */
  noticeDeadline: string | null;
}

export interface ContractFileRecord {
  id: string;
  kind: ContractFileKind;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  uploadedByName: string;
  createdAt: string;
}

export const contractSigningStates = [
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
export type ContractSigningState = (typeof contractSigningStates)[number];
export const terminalContractSigningStates: readonly ContractSigningState[] = [
  "completed",
  "declined",
  "expired",
  "canceled",
];

export const contractApprovalStates = [
  "not_required",
  "pending",
  "approved",
  "rejected",
] as const;
export type ContractApprovalState = (typeof contractApprovalStates)[number];

export interface ContractSigner {
  name: string;
  email: string;
  title: string;
}

export interface ContractSigningRecord {
  contractId: string;
  templateId: string;
  templateVersion: string;
  templateHash: string;
  input: Record<string, string>;
  counterpartySigner: ContractSigner;
  countersigner: ContractSigner & { id: string };
  preparerId: string;
  preparerName: string;
  approvalRequired: boolean;
  approvalState: ContractApprovalState;
  approverName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  state: ContractSigningState;
  providerId: string | null;
  testMode: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
}

export interface ContractRecord extends ContractTermSchedule {
  id: string;
  source: "register" | "template";
  counterpartyName: string;
  title: string;
  contractType: ContractType;
  paper: ContractPaper;
  status: ContractStatus;
  effectiveDate: string | null;
  initialTermMonths: number | null;
  autoRenew: boolean;
  renewalTermMonths: number | null;
  noticePeriodDays: number | null;
  valueMinor: number | null;
  currency: ContractCurrency | null;
  pricingNotes: string;
  ownerName: string;
  internalNotes: string;
  tags: string[];
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** One row of the register list. Executed MNDAs appear read-only. */
export interface ContractListRow extends ContractTermSchedule {
  id: string;
  source: "register" | "template" | "mnda";
  counterpartyName: string;
  title: string;
  contractType: ContractType;
  paper: ContractPaper;
  status: ContractStatus;
  effectiveDate: string | null;
  autoRenew: boolean;
  noticePeriodDays: number | null;
  ownerName: string;
  tags: string[];
  documentCount: number;
  updatedAt: string;
}

export const contractSorts = [
  "counterparty",
  "type",
  "status",
  "effective",
  "renewal",
  "notice",
  "updated",
] as const;
export type ContractSort = (typeof contractSorts)[number];
export const contractRenewalWindows = [30, 60, 90] as const;

const firstValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : value === "" ? undefined : value;

/** Register filters, read from URL search parameters. Unknown values fall
 * back to defaults rather than failing the page. */
export const ContractListQuerySchema = z.object({
  q: z.preprocess(firstValue, z.string().trim().max(100).catch("")).default(""),
  type: z.preprocess(
    firstValue,
    z.enum(contractTypes).optional().catch(undefined),
  ),
  status: z.preprocess(
    firstValue,
    z.enum(contractStatuses).optional().catch(undefined),
  ),
  window: z.preprocess(
    (value) => {
      const first = firstValue(value);
      return first === undefined ? undefined : Number(first);
    },
    z
      .union([z.literal(30), z.literal(60), z.literal(90)])
      .optional()
      .catch(undefined),
  ),
  sort: z.preprocess(
    firstValue,
    z.enum(contractSorts).default("updated").catch("updated"),
  ),
  direction: z.preprocess(
    firstValue,
    z.enum(["asc", "desc"]).optional().catch(undefined),
  ),
  page: z.preprocess(
    (value) => Number(firstValue(value) ?? 1),
    z.number().int().min(1).max(10_000).catch(1),
  ),
});
export type ContractListQuery = z.infer<typeof ContractListQuerySchema>;
export const contractPageSize = 25;

export interface ContractActivity {
  id: string;
  eventType: string;
  actorName: string;
  changes:
    Record<string, { from: unknown; to: unknown }> | Record<string, unknown>;
  occurredAt: string;
}

/** A stored document as the store reports it. */
export interface StoredDocument {
  backend: string;
  key: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Where contract and sales PDFs live. The register stores only the backend
 * name and key, so a Fil One S3-compatible store can replace the database
 * store by configuration without changing the contract tables.
 */
export interface ContractDocumentStore {
  readonly backend: string;
  put(
    bytes: Uint8Array,
    options: { purpose: "contract" | "collateral"; contentType: string },
  ): Promise<StoredDocument>;
  /** Throws `DOCUMENT_INTEGRITY` when the bytes no longer match their hash. */
  get(key: string): Promise<{ bytes: Uint8Array; document: StoredDocument }>;
  delete(key: string): Promise<void>;
}

/** Rejects anything that is not a PDF within the size limit. */
export function assertContractPdf(bytes: Uint8Array) {
  if (bytes.length === 0) throw new Error("DOCUMENT_EMPTY");
  if (bytes.length > contractDocumentMaxBytes)
    throw new Error("DOCUMENT_TOO_LARGE");
  if (
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  )
    throw new Error("DOCUMENT_NOT_PDF");
}

/** File names as typed by people: printable, no path separators. */
export const ContractFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(noControl, "control_character")
  .transform((name) => name.replace(/[\\/:*?"<>|]+/g, "-"));

export const salesCollateralKinds = [
  "pitch_deck",
  "one_pager",
  "pricing_sheet",
  "case_study",
  "other",
] as const;
export type SalesCollateralKind = (typeof salesCollateralKinds)[number];
export const salesAudiences = ["customer", "partner"] as const;
export type SalesAudience = (typeof salesAudiences)[number];
export const salesCollateralStatuses = ["current", "archived"] as const;
export type SalesCollateralStatus = (typeof salesCollateralStatuses)[number];

export const SalesCollateralInputSchema = z
  .object({
    id: z.uuid(),
    title: line(160),
    description: notes(1000),
    kind: z.enum(salesCollateralKinds),
    audience: z.enum(salesAudiences),
    status: z.enum(salesCollateralStatuses),
    contentUpdatedOn: z.iso.date(),
    linkUrl: z
      .string()
      .trim()
      .max(2000)
      .pipe(
        z.union([
          z.literal(""),
          z
            .url({ protocol: /^https$/ })
            .refine((url) => !new URL(url).username && !new URL(url).password),
        ]),
      )
      .default(""),
  })
  .strict();
export type SalesCollateralInput = z.infer<typeof SalesCollateralInputSchema>;

export interface SalesCollateralRecord {
  id: string;
  title: string;
  description: string;
  kind: SalesCollateralKind;
  audience: SalesAudience;
  status: SalesCollateralStatus;
  contentUpdatedOn: string;
  linkUrl: string | null;
  file: { fileName: string; sizeBytes: number; sha256: string } | null;
  updatedByName: string;
  updatedAt: string;
  version: number;
}
