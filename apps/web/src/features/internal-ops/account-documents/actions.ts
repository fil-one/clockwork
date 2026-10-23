"use server";

import { z } from "zod";

import {
  AccountDocumentTargetSchema,
  type AccountDocumentRecord,
  type RemovedAccountDocumentRecord,
} from "@clockwork/contracts";

import { SessionExpiredError } from "@/src/auth/session";

import { attempt, type ActionResult } from "../contracts/action-result";
import { contractActor } from "../contracts/server";
import { accountDocumentRepository, accountDocumentStaff } from "./server";

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  return attempt(async () => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SessionExpiredError)
        throw new Error("SESSION_EXPIRED");
      throw error;
    }
  });
}

const RequestSchema = z
  .object({ target: AccountDocumentTargetSchema })
  .passthrough();

/**
 * Takes a document off its record, with the reason. Who may attach may
 * remove: the record's read permission plus `contract:write`, checked on a
 * real staff session with MFA. The file and its history are kept.
 */
export async function removeAccountDocument(raw: unknown) {
  return run(async (): Promise<RemovedAccountDocumentRecord> => {
    const { target, ...input } = RequestSchema.parse(raw);
    const session = await accountDocumentStaff(target, true);
    return accountDocumentRepository().remove(
      target,
      input,
      contractActor(session),
    );
  });
}

/** Puts a removed document back on its record. */
export async function restoreAccountDocument(raw: unknown) {
  return run(async (): Promise<AccountDocumentRecord> => {
    const { target, ...input } = RequestSchema.parse(raw);
    const session = await accountDocumentStaff(target, true);
    return accountDocumentRepository().restore(
      target,
      input,
      contractActor(session),
    );
  });
}
