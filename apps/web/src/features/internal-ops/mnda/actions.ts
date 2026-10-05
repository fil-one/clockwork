"use server";

import { z } from "zod";
import {
  MndaCancelSchema,
  MndaCorrectSignerSchema,
  MndaInputSchema,
  MndaRegisterQuerySchema,
  MndaSettingsSchema,
  MndaSignerSchema,
  type MndaRecord,
  type MndaRegisterPage,
  type MndaResult,
  type MndaSettings,
  type MndaSigner,
} from "@clockwork/contracts";
import type { MndaRegisterMatch } from "@clockwork/db";
import { mndaTemplateHash, renderMnda } from "@clockwork/documents";
import { mndaFailure, mndaInvalid } from "./results";
import {
  mndaActor,
  mndaCanManage,
  mndaConfiguration,
  mndaRepository,
  mndaSigners,
  mndaStaff,
  mndaWorkflow,
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
export interface MndaSettingsData {
  signers: MndaSigner[];
  settings: MndaSettings;
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
  return attempt(async () => {
    const session = await mndaStaff();
    const query = MndaRegisterQuerySchema.parse(rawQuery);
    const repository = mndaRepository();
    const [register, signers, settings] = await Promise.all([
      repository.list(query, session.userId),
      mndaSigners(),
      repository.settings(),
    ]);
    return {
      register,
      signers: signers.filter((s) => s.active),
      noticeEmail: settings.noticeEmail,
      ...mndaConfiguration(),
      canManage: mndaCanManage(session),
      viewerId: session.userId,
    };
  });
}

const PrepareSchema = z
  .object({ input: z.unknown(), supersedes: z.uuid().optional() })
  .strict();
/**
 * Renders and stores a draft for preview. Re-previewing after an edit passes
 * the previous draft as `supersedes`, which is discarded in the same step.
 */
export async function prepareMnda(
  raw: unknown,
): Promise<MndaResult<MndaRecord>> {
  try {
    const session = await mndaStaff();
    const { input: rawInput, supersedes } = PrepareSchema.parse(raw);
    const parsed = MndaInputSchema.safeParse(rawInput);
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
      supersedes,
    );
    return { ok: true, value: record };
  } catch (error) {
    return mndaFailure(error);
  }
}

/** Existing requests for the same company, so a seller does not double-paper. */
export async function findMndaDuplicates(
  raw: unknown,
): Promise<MndaResult<MndaRegisterMatch[]>> {
  return attempt(async () => {
    await mndaStaff();
    const { company, excludeId } = z
      .object({
        company: z.string().trim().max(180),
        excludeId: z.uuid().optional(),
      })
      .strict()
      .parse(raw);
    return mndaRepository().duplicates(company, excludeId);
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
    return mndaWorkflow()[operation](id, mndaActor(session));
  });
}

export async function voidMnda(raw: unknown): Promise<MndaResult<MndaRecord>> {
  try {
    const session = await mndaStaff();
    const parsed = MndaCancelSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        code: "reason_required",
        fields: [{ field: "reason", code: "reason_required" }],
      };
    return {
      ok: true,
      value: await mndaWorkflow().void(
        parsed.data.id,
        mndaActor(session),
        parsed.data.reason,
      ),
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
    await mndaStaff("signatory:manage");
    return {
      signers: await mndaSigners(),
      settings: await mndaRepository().settings(),
    };
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
