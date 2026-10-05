"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { OwnerConsoleRepository } from "@clockwork/db";

import type { CommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  requireStaffPermission,
  StaffPermissionError,
} from "@/src/features/shell/staff-access";

import type { NoticeActionResult } from "./model";

const MarkReadSchema = z
  .object({
    noticeIds: z.union([z.literal("all"), z.array(z.uuid()).min(1).max(100)]),
  })
  .strict();

type Failure = Extract<NoticeActionResult, { ok: false }>;
const fail = (code: Failure["code"]): Failure => ({ ok: false, code });

/**
 * Marks the reader's own notices read. Only a commerce administrator in their
 * own verified session may, and the repository only ever touches notices
 * addressed to them, whatever ids arrive.
 */
export async function markNoticesRead(
  raw: unknown,
): Promise<NoticeActionResult> {
  let session: CommerceSession;
  try {
    session = await requireStaffPermission("staff:manage");
  } catch (error) {
    if (error instanceof StaffPermissionError) return fail("NOT_PERMITTED");
    return fail("DIRECT_SESSION_REQUIRED");
  }
  if (
    !session.mfaVerified ||
    session.impersonation ||
    session.assistedSession ||
    session.authenticationProviderImpersonator
  )
    return fail("DIRECT_SESSION_REQUIRED");
  const database = getOptionalServiceDatabase();
  if (!session.providerBacked || !database) return fail("NOT_CONFIGURED");
  const parsed = MarkReadSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    const marked = await new OwnerConsoleRepository(database).markNoticesRead({
      viewerUserId: session.userId,
      noticeIds: parsed.data.noticeIds,
      requestId: `owner-console-notices:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/owner");
    return { ok: true, marked };
  } catch (error) {
    console.error("Owner console notices could not be marked read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail("UNEXPECTED");
  }
}
