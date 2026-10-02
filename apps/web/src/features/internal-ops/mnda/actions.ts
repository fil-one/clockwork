"use server";

import { z } from "zod";
import { MndaInputSchema, type MndaRecord } from "@clockwork/contracts";
import { mndaTemplateHash, renderMnda } from "@clockwork/documents";
import {
  mndaActor,
  mndaConfiguration,
  mndaRepository,
  mndaSigners,
  mndaStaff,
  mndaWorkflow,
} from "./server";

export async function loadMndas() {
  const session = await mndaStaff();
  return {
    records: await mndaRepository().list(),
    signers: await mndaSigners(),
    ...mndaConfiguration(),
    canManage: session.roles.some((r) =>
      ["internal_operator", "finance_approver", "legal_approver"].includes(r),
    ),
  };
}
export async function prepareMnda(
  raw: unknown,
): Promise<{ record: MndaRecord; pdf: string }> {
  const session = await mndaStaff();
  const input = MndaInputSchema.parse(raw);
  const signer = (await mndaSigners()).find(
    (s) => s.id === input.countersignerId && s.active,
  );
  if (!signer) throw new Error("MNDA_SIGNER_REQUIRED");
  if (signer.email === input.signerEmail)
    throw new Error("MNDA_DISTINCT_SIGNERS_REQUIRED");
  const pdf = await renderMnda(input, signer);
  const record = await mndaRepository().create(
    input,
    { id: session.userId, name: session.profile.name },
    mndaTemplateHash,
    mndaConfiguration().testMode,
    pdf.bytes,
    signer,
  );
  return {
    record,
    pdf: (await mndaRepository().readArtifact(record.id, "original")).toString(
      "base64",
    ),
  };
}
export async function operateMnda(raw: unknown) {
  const session = await mndaStaff();
  const { id, operation } = z
    .object({
      id: z.uuid(),
      operation: z.enum(["send", "sync", "remind", "cancel"]),
    })
    .strict()
    .parse(raw);
  return mndaWorkflow()[operation](id, mndaActor(session));
}
export async function downloadMnda(raw: unknown) {
  await mndaStaff();
  const { id, kind } = z
    .object({ id: z.uuid(), kind: z.enum(["original", "executed"]) })
    .parse(raw);
  return (await mndaRepository().readArtifact(id, kind)).toString("base64");
}
export async function configureMndaSigner(raw: unknown) {
  const session = await mndaStaff(true);
  await mndaRepository().saveSigner(raw, mndaActor(session));
}
