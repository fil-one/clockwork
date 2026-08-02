import type { DatabaseExperienceRepository } from "./repository";

type RepositoryMethod<Key extends keyof DatabaseExperienceRepository> =
  DatabaseExperienceRepository[Key];

/**
 * The repository surface the experience controller reaches. It is derived from
 * the database repository so the two can never drift, and it carries no private
 * members, which is what lets a fixture-backed implementation stand in for the
 * database one.
 */
export interface ExperienceRepository {
  invoiceDerivation: RepositoryMethod<"invoiceDerivation">;
  accountInvoiceDerivations: RepositoryMethod<"accountInvoiceDerivations">;
  signingTarget: RepositoryMethod<"signingTarget">;
  createEsignCorrelation: RepositoryMethod<"createEsignCorrelation">;
  readEsignReturn: RepositoryMethod<"readEsignReturn">;
  readEsignSignedDocument: RepositoryMethod<"readEsignSignedDocument">;
  reserveEvidence: RepositoryMethod<"reserveEvidence">;
  readEvidence: RepositoryMethod<"readEvidence">;
  bindEvidenceProvider: RepositoryMethod<"bindEvidenceProvider">;
  markEvidenceScanning: RepositoryMethod<"markEvidenceScanning">;
  expireEvidence: RepositoryMethod<"expireEvidence">;
  quarantineEvidence: RepositoryMethod<"quarantineEvidence">;
  promoteEvidence: RepositoryMethod<"promoteEvidence">;
  createRenderRequest: RepositoryMethod<"createRenderRequest">;
  findRenderRequest: RepositoryMethod<"findRenderRequest">;
  claimRenderRequest: RepositoryMethod<"claimRenderRequest">;
  failRenderRequest: RepositoryMethod<"failRenderRequest">;
  storeArtifact: RepositoryMethod<"storeArtifact">;
  findArtifact: RepositoryMethod<"findArtifact">;
}
