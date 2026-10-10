import { z } from "zod";

/**
 * Handoff requests: a seller hands a signed contract to operations so the
 * counterparty becomes a customer or partner organization in Commerce.
 * Sellers with `contract:write` raise them, `operations:read` reads the
 * queue and `operations:write` takes, completes and declines them.
 */
export const handoffStatuses = [
  "open",
  "in_progress",
  "done",
  "declined",
] as const;
export type HandoffStatus = (typeof handoffStatuses)[number];

/** The side the seller asks for. Operations picks channel or referral. */
export const handoffRequestedSides = ["customer", "partner"] as const;
export type HandoffRequestedSide = (typeof handoffRequestedSides)[number];

export const handoffContractLimit = 10;
export const handoffListLimit = 200;

const noControl = (value: string) =>
  [...value].every((c) => c.charCodeAt(0) >= 32);
const line = (max: number) =>
  z.string().trim().min(1).max(max).refine(noControl, "control_character");
const note = (max: number) =>
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
    );

export const HandoffRequestInputSchema = z
  .object({
    id: z.uuid(),
    contractIds: z
      .array(z.guid())
      .min(1)
      .max(handoffContractLimit)
      .refine((ids) => new Set(ids).size === ids.length, "repeated"),
    mndaId: z.guid().nullable().default(null),
    pricingScenarioId: z.guid().nullable().default(null),
    counterpartyLegalName: line(200),
    signerName: line(200),
    signerEmail: z
      .email()
      .max(320)
      .transform((value) => value.toLowerCase()),
    signerTitle: z
      .string()
      .trim()
      .max(200)
      .refine(noControl, "control_character")
      .default(""),
    requestedSide: z.enum(handoffRequestedSides),
    notes: note(4000).default(""),
  })
  .strict();

/** Take, complete or decline. A decline needs a note; the others may add one. */
export const HandoffDecisionInputSchema = z
  .object({
    id: z.guid(),
    expectedVersion: z.int().min(1),
    note: note(2000)
      .transform((value) => value.trim())
      .optional()
      .transform((value) => value || undefined),
  })
  .strict();

export interface HandoffRequestRecord {
  id: string;
  requestedById: string;
  requestedByName: string;
  counterpartyLegalName: string;
  signerName: string;
  signerEmail: string;
  signerTitle: string;
  contractIds: string[];
  mndaId: string | null;
  pricingScenarioId: string | null;
  requestedSide: HandoffRequestedSide;
  notes: string;
  status: HandoffStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Refusals a handoff action can return; the page words each one. */
export const handoffErrorCodes = [
  "HANDOFF_NOT_FOUND",
  "HANDOFF_VERSION_CONFLICT",
  "HANDOFF_CONTRACT_NOT_SIGNED",
  "HANDOFF_ALREADY_REQUESTED",
  "HANDOFF_MNDA_NOT_COMPLETED",
  "HANDOFF_PRICING_SCENARIO_NOT_FOUND",
  "HANDOFF_PRICING_SCENARIO_NOT_OWNED",
  "HANDOFF_MNDA_COMPANY_MISMATCH",
  "HANDOFF_TRANSITION_INVALID",
  "HANDOFF_NOT_ASSIGNEE",
  "HANDOFF_REQUEST_CLOSED",
  "HANDOFF_DECLINE_NOTE_REQUIRED",
  "HANDOFF_IDEMPOTENCY_CONFLICT",
] as const;
