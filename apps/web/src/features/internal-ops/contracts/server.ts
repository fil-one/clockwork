import "server-only";
import {
  contextHasPermission,
  type Actor,
  type Permission,
} from "@clockwork/contracts";
import {
  ContractDocumentStores,
  ContractRepository,
  ContractSigningRepository,
  PostgresContractDocumentStore,
  SalesLibraryRepository,
} from "@clockwork/db";
import { contractTemplates } from "@clockwork/documents";
import { SignWellContractClient } from "@clockwork/integrations";
import { ContractSigningWorkflow } from "@clockwork/workflows/contracts";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

export type ContractAccessFailure =
  "CONTRACT_DEMO_UNAVAILABLE" | "CONTRACT_MFA_REQUIRED" | "CONTRACT_FORBIDDEN";

export class ContractAccessError extends Error {
  constructor(readonly code: ContractAccessFailure) {
    super(code);
  }
}

export function sessionHas(
  session: Pick<CommerceSession, "roles" | "permissions">,
  permission: Permission,
) {
  return contextHasPermission(session, permission);
}

/**
 * Every contract and sales-library read or write passes through here. Staff
 * reach these tables through the service role, which row security does not
 * narrow, so this check is the guard: a real internal staff session verified
 * with a second factor, not impersonating or assisting, holding the
 * permission the operation needs. Demo identities never reach real documents.
 */
export async function contractStaff(permission: Permission) {
  if (explicitDemoIdentityEnabled())
    throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  const session = await getCommerceSession();
  if (
    !session.isInternalStaff ||
    session.impersonation ||
    session.assistedSession
  )
    throw new ContractAccessError("CONTRACT_FORBIDDEN");
  if (!session.mfaVerified)
    throw new ContractAccessError("CONTRACT_MFA_REQUIRED");
  if (!sessionHas(session, permission))
    throw new ContractAccessError("CONTRACT_FORBIDDEN");
  return session;
}

export type ContractStaffSession = Awaited<ReturnType<typeof contractStaff>>;

export function contractActor(session: ContractStaffSession) {
  return {
    kind: "user",
    id: session.userId,
    display: session.profile.name,
  } satisfies Actor;
}

/**
 * The document store contract and collateral PDFs are written to. Only the
 * database store exists today; a Fil One S3-compatible store is added here,
 * selected by `COMMERCE_DOCUMENT_STORE`, with the database store kept for
 * reading files written before the move.
 */
export function documentStores() {
  const configured = process.env.COMMERCE_DOCUMENT_STORE ?? "postgres";
  if (configured !== "postgres")
    throw new Error("DOCUMENT_BACKEND_UNAVAILABLE");
  return new ContractDocumentStores(
    new PostgresContractDocumentStore(getServiceDatabase()),
  );
}

export const contractRepository = () =>
  new ContractRepository(getServiceDatabase(), documentStores);
export const contractSigningRepository = () =>
  new ContractSigningRepository(getServiceDatabase(), documentStores);
export const salesLibraryRepository = () =>
  new SalesLibraryRepository(getServiceDatabase(), documentStores);

/** Production templates. Tests supply their own registry instead. */
export const contractTemplateRegistry = () => contractTemplates;

export function contractSigningConfiguration() {
  return {
    ready:
      process.env.COMMERCE_CONTRACTS_SIGNING_ENABLED === "true" &&
      Boolean(process.env.SIGNWELL_API_KEY && process.env.SIGNWELL_WEBHOOK_ID),
    testMode: process.env.COMMERCE_CONTRACTS_TEST_MODE !== "false",
  };
}

/**
 * The signing workflow. Discarding an unsent draft needs no provider, so it
 * works where sending is not set up; every provider call then fails with
 * `CONTRACT_SIGNING_NOT_CONFIGURED`.
 */
export function contractSigningWorkflow(
  operation: "send" | "sync" | "remind" | "cancel" = "send",
) {
  const apiKey = process.env.SIGNWELL_API_KEY;
  if (contractSigningConfiguration().ready && apiKey)
    return new ContractSigningWorkflow(
      contractSigningRepository(),
      new SignWellContractClient(apiKey),
    );
  if (operation !== "cancel")
    throw new Error("CONTRACT_SIGNING_NOT_CONFIGURED");
  const unavailable = () =>
    Promise.reject(new Error("CONTRACT_SIGNING_NOT_CONFIGURED"));
  return new ContractSigningWorkflow(contractSigningRepository(), {
    createContractDraft: unavailable,
    getContract: unavailable,
    send: unavailable,
    remind: unavailable,
    completedPdf: unavailable,
  });
}
