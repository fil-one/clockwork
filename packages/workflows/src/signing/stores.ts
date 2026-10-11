import {
  contractPdfFileName,
  contractSignerEmail,
  mndaSignerEmail,
  type ContractSigningRecord,
  type MndaRecord,
} from "@clockwork/contracts";
import type { ContractSigningRepository, MndaRepository } from "@clockwork/db";
import {
  contractCopiedContacts,
  signWellCopiedContacts,
} from "@clockwork/integrations";
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
    capabilities: new Set([
      "signer_correction",
      "cancel_code",
      "captured_fields",
    ]),
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
    update: (r, token, { capturedFields, ...patch }, actor, executed, note) =>
      repo.update(
        r.id,
        token,
        capturedFields ? { ...patch, partnerDetails: capturedFields } : patch,
        actor,
        executed,
        note,
      ),
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

const contractPatchKeys: ReadonlySet<string> = new Set([
  "state",
  "providerId",
  "error",
  "remindedAt",
  "correctedSignerEmail",
  "pendingSignerEmail",
  "cancelCode",
  "cancelReason",
]);

/** The contract table keeps the counterparty's pending and confirmed email
 * corrections and a cancel code (001459), with before-images in the
 * contract's history, one entry per change, and copies the preparer on the
 * completed document (001465). It has no `superseded` code or captured-field
 * columns, and the adapter refuses a change carrying anything else it cannot
 * keep, or a note with a follow-up, rather than drop it. */
export function contractSigningStore(
  repo: ContractSigningStoreRepository,
): SigningStore<ContractSigningRecord> {
  return {
    capabilities: new Set(["signer_correction", "cancel_code"]),
    view: (r) => ({
      id: r.contractId,
      state: r.state,
      providerId: r.providerId,
      testMode: r.testMode,
      templateHash: r.templateHash,
      error: r.error,
      remindedAt: r.remindedAt,
      approved: ["not_required", "approved"].includes(r.approvalState),
      // Counterparty paper they signed already goes to Fil One alone.
      signers: {
        ...(r.counterpartySigns
          ? {
              counterparty: {
                name: r.counterpartySigner.name,
                email: contractSignerEmail(r),
                accepted: [
                  r.counterpartySigner.email,
                  r.correctedSignerEmail,
                  r.pendingSignerEmail,
                ].filter((email): email is string => Boolean(email)),
                pending: r.pendingSignerEmail,
              },
            }
          : {}),
        "fil-one": {
          name: r.countersigner.name,
          email: r.countersigner.email,
          accepted: [r.countersigner.email],
          pending: null,
        },
      },
      copiedContacts: contractCopiedContacts(r).map((c) => c.email),
    }),
    claim: (id) => repo.claim(id),
    extendLease: (id, token) => repo.extendLease(id, token),
    release: (id, token) => repo.release(id, token),
    get: (id) => repo.get(id),
    originalPdf: (id) => repo.generatedPdf(id),
    update: async (r, token, patch, actor, executed, note) => {
      // A note without its own event, such as whether SignWell reported the
      // preparer's copy, is kept on the state change's entry.
      const eventType =
        note?.eventType ??
        (note && patch.state ? `contract.signing_${patch.state}` : undefined);
      if (
        Object.keys(patch).some((key) => !contractPatchKeys.has(key)) ||
        note?.followUp ||
        (note && !eventType)
      )
        throw new Error("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
      const { cancelCode, ...kept } = patch;
      if (cancelCode === "superseded")
        throw new Error("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
      return repo.update(
        r.contractId,
        token,
        { ...kept, ...(cancelCode ? { cancelCode } : {}) },
        actor,
        executed && {
          bytes: executed,
          fileName: contractPdfFileName(r.documentName, " (executed)"),
        },
        note && eventType
          ? {
              eventType,
              ...(note.detail ? { detail: note.detail } : {}),
              ...(note.before ? { before: note.before } : {}),
            }
          : undefined,
      );
    },
    decide: (id, decision, actor) => repo.decide(id, decision, actor),
  };
}
