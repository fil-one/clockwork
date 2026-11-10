import { z } from "zod";
import type { SigningState } from "./signing";

export type SigningJourneyKind = "mnda" | "contract";
export type SigningMailPurpose = "invite" | "reminder" | "completed";

/** A recipient capability never grants staff or general account access. */
export interface SigningRecipient {
  id: string;
  kind: SigningJourneyKind;
  requestId: string;
  providerId: string;
  slot: string;
  name: string;
  email: string;
  nonce: string;
  title: string;
  testMode: boolean;
  signed: boolean;
  nextToSign: boolean;
  revoked: boolean;
}

export interface SigningJourneySnapshot {
  sourceVersion: number;
  kind: SigningJourneyKind;
  requestId: string;
  providerId: string;
  title: string;
  testMode: boolean;
  state: SigningState;
  recipients: readonly {
    slot: string;
    name: string;
    email: string;
    signed: boolean;
  }[];
  nextSlot: string | null;
}

/** Safe, minimal data for the recipient screen. No provider links or other
 * recipient addresses are included until an authorized launch. */
export const RecipientSigningViewSchema = z.object({
  title: z.string(),
  recipientName: z.string(),
  state: z.enum([
    "ready",
    "waiting",
    "signed",
    "completed",
    "closed",
    "attention",
  ]),
  testMode: z.boolean(),
  canDownload: z.boolean(),
});
export type RecipientSigningView = z.infer<typeof RecipientSigningViewSchema>;
