"use server";

import { z } from "zod";
import {
  contextHasPermission,
  MndaCorrectSignerSchema,
  MndaDraftInputSchema,
  MndaRegisterQuerySchema,
  MndaSettingsSchema,
  MndaSignerSchema,
  MndaVoidSchema,
  type MndaRecord,
  type MndaRegisterPage,
  type MndaResult,
  type MndaSettings,
  type MndaSigner,
} from "@clockwork/contracts";
import type { MndaContractMatch, MndaRegisterMatch } from "@clockwork/db";
import { mndaTemplateHash, renderMnda } from "@clockwork/documents";
import { mndaSettingsData, mndaWorkspaceData } from "./page-data";
import { mndaFailure, mndaInvalid } from "./results";
import {
  mndaActor,
  mndaCanManage,
  mndaConfiguration,
  mndaRepository,
  mndaSigners,
  mndaStaff,
  mndaWorkflow,
  type MndaSession,
} from "./server";

export interface MndaWorkspaceData {
  register: MndaRegisterPage;
  signers: MndaSigner[];
  noticeEmail: string;
  ready: boolean;
  testMode: boolean;
  canManage: boolean;
  viewerId: string;
}
export interface MndaDuplicates {
  mndas: MndaRegisterMatch[];
  /** Contract register rows, for staff who may read contracts. */
  contracts: MndaContractMatch[];
}
export interface MndaSettingsData {
  signers: MndaSigner[];
  settings: MndaSettings;
}

/** Voiding, discarding and fixing the partner email belong to the person who
 * prepared the MNDA, or a signatory manager. */
async function assertMndaOwner(session: MndaSession, id: string) {
  if (mndaCanManage(session)) return;
  const record = await mndaRepository().get(id);
  if (record.ownerId !== session.userId) throw new Error("MNDA_NOT_OWNER");
}

async function attempt<T>(fn: () => Promise<T>): Promise<MndaResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return mndaFailure(error);
  }
}

export async function loadMndas(
  rawQuery: unknown = {},
): Promise<MndaResult<MndaWorkspaceData>> {
  return attempt(async () => mndaWorkspaceData(await mndaStaff(), rawQuery));
}

/** Only the register, for the open page's refresh: countersigners and the
 * notice email change on the settings page, not while the list is open. */
export async function loadMndaRegister(
  rawQuery: unknown = {},
): Promise<MndaResult<Pick<MndaWorkspaceData, "register">>> {
  return attempt(async () => {
    const session = await mndaStaff();
    const query = MndaRegisterQuerySchema.parse(rawQuery);
    return { register: await mndaRepository().list(query, session.userId) };
  });
}

const PrepareSchema = z
  .object({
    input: z.unknown(),
    supersedes: z.array(z.uuid()).max(2).optional(),
  })
  .strict();
/**
 * Renders and stores a draft for preview. Re-previewing after an edit passes
 * the previous drafts as `supersedes`, which are discarded in the same step;
 * only the preparer or a signatory manager may replace a draft.
 */
export async function prepareMnda(
  raw: unknown,
): Promise<MndaResult<MndaRecord>> {
  try {
    const session = await mndaStaff();
    const { input: rawInput, supersedes } = PrepareSchema.parse(raw);
    const parsed = MndaDraftInputSchema.safeParse(rawInput);
    if (!parsed.success) return mndaInvalid(parsed.error);
    const input = parsed.data;
    const repository = mndaRepository();
    const signer = (await mndaSigners()).find(
      (s) => s.id === input.countersignerId && s.active,
    );
    if (!signer) throw new Error("MNDA_SIGNER_REQUIRED");
    if (signer.email === input.signerEmail)
      throw new Error("MNDA_DISTINCT_SIGNERS_REQUIRED");
    const { noticeEmail } = await repository.settings();
    const pdf = await renderMnda(input, signer, { noticeEmail });
    const record = await repository.create(
      input,
      {
        id: session.userId,
        name: session.profile.name,
        email: session.profile.email,
      },
      mndaTemplateHash,
      mndaConfiguration().testMode,
      pdf.bytes,
      signer,
      noticeEmail,
      {
        ...(supersedes ? { supersedes } : {}),
        manageAll: mndaCanManage(session),
      },
    );
    return { ok: true, value: record };
  } catch (error) {
    return mndaFailure(error);
  }
}

/** Existing MNDAs and register contracts for the same company, so a seller
 * does not double-paper. */
export async function findMndaDuplicates(
  raw: unknown,
): Promise<MndaResult<MndaDuplicates>> {
  return attempt(async () => {
    const session = await mndaStaff();
    const { company, excludeId } = z
      .object({
        company: z.string().trim().max(180),
        excludeId: z.uuid().optional(),
      })
      .strict()
      .parse(raw);
    const repository = mndaRepository();
    const [mndas, contracts] = await Promise.all([
      repository.duplicates(company, excludeId),
      contextHasPermission(session, "contract:read")
        ? repository.contractDuplicates(company)
        : [],
    ]);
    return { mndas, contracts };
  });
}

export async function operateMnda(
  raw: unknown,
): Promise<MndaResult<MndaRecord>> {
  return attempt(async () => {
    const session = await mndaStaff();
    const { id, operation } = z
      .object({
        id: z.uuid(),
        operation: z.enum(["send", "sync", "remind", "cancel"]),
      })
      .strict()
      .parse(raw);
    // Discarding a draft is the preparer's call, or a signatory manager's.
    if (operation === "cancel") await assertMndaOwner(session, id);
    return mndaWorkflow()[operation](id, mndaActor(session));
  });
}

export async function voidMnda(raw: unknown): Promise<MndaResult<MndaRecord>> {
  try {
    const session = await mndaStaff();
    const parsed = MndaVoidSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        code: "reason_required",
        fields: [{ field: "reason", code: "reason_required" }],
      };
    const { id, ...why } = parsed.data;
    await assertMndaOwner(session, id);
    return {
      ok: true,
      value: await mndaWorkflow().void(id, mndaActor(session), why),
    };
  } catch (error) {
    return mndaFailure(error);
  }
}

export async function correctMndaSigner(
  raw: unknown,
): Promise<MndaResult<MndaRecord>> {
  try {
    const session = await mndaStaff();
    const parsed = MndaCorrectSignerSchema.safeParse(raw);
    if (!parsed.success) return mndaInvalid(parsed.error);
    await assertMndaOwner(session, parsed.data.id);
    return {
      ok: true,
      value: await mndaWorkflow().correctSigner(
        parsed.data.id,
        mndaActor(session),
        parsed.data.signerEmail,
      ),
    };
  } catch (error) {
    return mndaFailure(error);
  }
}

export async function loadMndaSettings(): Promise<
  MndaResult<MndaSettingsData>
> {
  return attempt(async () => {
    return mndaSettingsData(await mndaStaff("signatory:manage"));
  });
}

export async function configureMndaSigner(
  raw: unknown,
): Promise<MndaResult<null>> {
  try {
    const session = await mndaStaff("signatory:manage");
    const parsed = MndaSignerSchema.safeParse(raw);
    if (!parsed.success) return mndaInvalid(parsed.error);
    await mndaRepository().saveSigner(parsed.data, mndaActor(session));
    return { ok: true, value: null };
  } catch (error) {
    return mndaFailure(error);
  }
}

export async function saveMndaSettings(
  raw: unknown,
): Promise<MndaResult<null>> {
  try {
    const session = await mndaStaff("signatory:manage");
    const { version, ...input } = z
      .object({ noticeEmail: z.unknown(), version: z.int().positive() })
      .strict()
      .parse(raw);
    const parsed = MndaSettingsSchema.safeParse(input);
    if (!parsed.success) return mndaInvalid(parsed.error);
    await mndaRepository().saveSettings(
      parsed.data,
      version,
      mndaActor(session),
    );
    return { ok: true, value: null };
  } catch (error) {
    return mndaFailure(error);
  }
}
