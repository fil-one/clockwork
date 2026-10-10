import {
  contractPdfFileName,
  mndaSignerEmail,
  type ContractSigningRecord,
  type MndaRecord,
} from "@clockwork/contracts";
import type { ContractSigningRepository, MndaRepository } from "@clockwork/db";
import { signWellCopiedContacts } from "@clockwork/integrations";
import type { SigningStore } from "./engine";

/** Thin adapters: each repository keeps its own table, lease, history and
 * evidence rules; these only translate between its record and the engine. */

export type MndaSigningRepository = Pick<
  MndaRepository,
  "claim" | "extendLease" | "release" | "update" | "get" | "readArtifact"
>;

export function mndaSigningStore(
  repo: MndaSigningRepository,
): SigningStore<MndaRecord> {
  return {
    capabilities: new Set(["signer_correction", "cancel_code"]),
    view: (r) => ({
      id: r.id,
      state: r.state,
      providerId: r.providerId,
      testMode: r.testMode,
      templateHash: r.templateHash,
      error: r.error,
      remindedAt: r.remindedAt,
      approved: true,
      signers: {
        counterparty: {
          name: r.input.signerName,
          email: mndaSignerEmail(r),
          accepted: [
            r.input.signerEmail,
            r.correctedSignerEmail,
            r.pendingSignerEmail,
          ].filter((email): email is string => Boolean(email)),
          pending: r.pendingSignerEmail,
        },
        "fil-one": {
          name: r.countersigner.name,
          email: r.countersigner.email,
          accepted: [r.countersigner.email],
          pending: null,
        },
      },
      copiedContacts: signWellCopiedContacts(r).map((c) => c.email),
    }),
    claim: (id) => repo.claim(id),
    extendLease: (id, token) => repo.extendLease(id, token),
    release: (id, token) => repo.release(id, token),
    get: (id) => repo.get(id),
    originalPdf: (id) => repo.readArtifact(id, "original"),
    update: (r, token, patch, actor, executed, note) =>
      repo.update(r.id, token, patch, actor, executed, note),
  };
}

export type ContractSigningStoreRepository = Pick<
  ContractSigningRepository,
  | "claim"
  | "extendLease"
  | "release"
  | "update"
  | "get"
  | "generatedPdf"
  | "decide"
>;

/** The contract table has no cancel code, correction or before-image
 * columns. The store declares none of them, and refuses a change carrying one
 * rather than drop it. */
export function contractSigningStore(
  repo: ContractSigningStoreRepository,
): SigningStore<ContractSigningRecord> {
  const signer = (s: { name: string; email: string }) => ({
    name: s.name,
    email: s.email,
    accepted: [s.email],
    pending: null,
  });
  return {
    capabilities: new Set(),
    view: (r) => ({
      id: r.contractId,
      state: r.state,
      providerId: r.providerId,
      testMode: r.testMode,
      templateHash: r.templateHash,
      error: r.error,
      remindedAt: r.remindedAt,
      approved: ["not_required", "approved"].includes(r.approvalState),
      signers: {
        counterparty: signer(r.counterpartySigner),
        "fil-one": signer(r.countersigner),
      },
      copiedContacts: [],
    }),
    claim: (id) => repo.claim(id),
    extendLease: (id, token) => repo.extendLease(id, token),
    release: (id, token) => repo.release(id, token),
    get: (id) => repo.get(id),
    originalPdf: (id) => repo.generatedPdf(id),
    update: async (r, token, patch, actor, executed, note) => {
      const { state, providerId, error, remindedAt, ...unkept } = patch;
      if (
        Object.keys(unkept).length > 0 ||
        note?.before ||
        (note && !note.eventType)
      )
        throw new Error("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
      return repo.update(
        r.contractId,
        token,
        {
          ...("state" in patch ? { state } : {}),
          ...("providerId" in patch ? { providerId } : {}),
          ...("error" in patch ? { error } : {}),
          ...("remindedAt" in patch ? { remindedAt } : {}),
        },
        actor,
        executed && {
          bytes: executed,
          fileName: contractPdfFileName(r.documentName, " (executed)"),
        },
        note?.eventType
          ? {
              eventType: note.eventType,
              ...(note.detail ? { detail: note.detail } : {}),
            }
          : undefined,
      );
    },
    decide: (id, decision, actor) => repo.decide(id, decision, actor),
  };
}
