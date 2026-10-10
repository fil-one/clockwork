import "server-only";
import { z } from "zod";
import {
  ContractListQuerySchema,
  contractRenewalWindows,
  counterpartyPaperFileKinds,
  type ContractFileRecord,
  type ContractListQuery,
  type ContractRecord,
  type ContractSigningRecord,
  type Permission,
} from "@clockwork/contracts";
import { contractToday } from "@clockwork/domain/contract-terms";
import { getRequestCommerceSession } from "@/src/auth/session";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import { mndaRepository } from "../mnda/server";
import { mayApproveOwnRequests } from "../self-approval/model";
import { contractReader, contractRegisterReader } from "./demo-access";
import type { PrepareStart } from "./prepare-input";
import {
  ContractAccessError,
  contractRepository,
  contractSigningConfiguration,
  contractSigningRepository,
  contractTemplateRegistry,
  sessionHas,
  type ContractAccessFailure,
  type ContractStaffSession,
} from "./server";

export type Loaded<T> =
  | ({ kind: "ready" } & T)
  | { kind: "denied"; code: ContractAccessFailure }
  | { kind: "missing" }
  | { kind: "error" };

/** Runs a page load behind the staff guard and turns refusals into states
 * the page can explain, instead of an error boundary. */
export async function loadWith<T>(
  permission: Permission,
  load: (session: ContractStaffSession) => Promise<T>,
): Promise<Loaded<T>> {
  try {
    const session = await contractReader(permission, getRequestCommerceSession);
    return { kind: "ready", ...(await load(session)) };
  } catch (error) {
    if (error instanceof ContractAccessError)
      return { kind: "denied", code: error.code };
    if (
      error instanceof Error &&
      (error.message === "CONTRACT_NOT_FOUND" ||
        error.message === "CONTRACT_TEMPLATE_NOT_FOUND")
    )
      return { kind: "missing" };
    console.error("contracts: page load failed", error);
    return { kind: "error" };
  }
}

const permissions = (session: ContractStaffSession) => ({
  canWrite: sessionHas(session, "contract:write"),
  canApprove: sessionHas(session, "contract:approve"),
});

/** Signed MNDAs join the register only for people who may open MNDAs.
 * "Recorded by me" is the signed-in reader. */
export const listScope = (session: ContractStaffSession) => ({
  includeMndas: sessionHas(session, "mnda:send"),
  viewerId: session.userId,
});

export function loadRegister(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return loadWith("contract:read", async (session) => {
    const query: ContractListQuery =
      ContractListQuerySchema.parse(searchParams);
    const today = contractToday(demoNow());
    return {
      query,
      today,
      result: await contractRegisterReader(session).list(
        query,
        today,
        listScope(session),
      ),
      canOpenMndas: listScope(session).includeMndas,
      ...permissions(session),
    };
  });
}

/** The uploaded PDFs a contract on the counterparty's paper can be sent
 * from, while it is unsigned and has no signing request. */
export function counterpartyPaperSources(detail: {
  contract: ContractRecord;
  files: readonly ContractFileRecord[];
  signing: ContractSigningRecord | null;
}) {
  const { contract, files, signing } = detail;
  if (
    signing ||
    contract.paper !== "theirs" ||
    contract.executedAt !== null ||
    !["draft", "in_negotiation"].includes(contract.status)
  )
    return [];
  return files.filter((file) => counterpartyPaperFileKinds.includes(file.kind));
}

export function loadContract(id: string) {
  return loadWith("contract:read", async (session) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("CONTRACT_NOT_FOUND");
    const today = contractToday(demoNow());
    const detail = await contractRegisterReader(session).get(id, today);
    const paper = permissions(session).canWrite
      ? counterpartyPaperSources(detail)
      : [];
    return {
      ...detail,
      today,
      // A contract on their paper with a PDF can be sent for the Fil One
      // countersignature; the form needs the PDFs and the countersigners.
      paperSources: paper,
      countersigners: paper.length
        ? await contractSigningRepository().countersigners()
        : [],
      ...permissions(session),
      isPreparer: detail.signing?.preparerId === session.userId,
      canSelfApprove: mayApproveOwnRequests(session),
      signingReady: contractSigningConfiguration().ready,
    };
  });
}

export function loadRenewals(window: unknown) {
  return loadWith("contract:read", async (session) => {
    const days =
      contractRenewalWindows.find((w) => String(w) === String(window)) ?? 90;
    const today = contractToday(demoNow());
    const repository = contractRegisterReader(session);
    return {
      days,
      today,
      rows: await repository.renewalsDue(today, days),
      passed: await repository.noticesPassed(today),
    };
  });
}

export function loadTemplates() {
  return loadWith("contract:read", (session) =>
    Promise.resolve({
      templates: contractTemplateRegistry().map((template) => ({
        id: template.id,
        contractType: template.contractType,
        status: template.status,
        ...(template.status === "available"
          ? {
              version: template.version,
              requiresApproval: template.requiresApproval,
            }
          : {}),
      })),
      ...permissions(session),
    }),
  );
}

/** The earlier values, with the counterparty signer left blank for the
 * person who will sign instead. */
async function prepareStart(
  from: string | undefined,
  templateId: string,
  fieldIds: readonly string[],
): Promise<PrepareStart | null> {
  // Only an id is read; anything else starts an empty form.
  if (!from || !z.uuid().safeParse(from).success) return null;
  try {
    const signing = await contractSigningRepository().get(from);
    if (signing.templateId !== templateId) return null;
    const { contract } = await contractRepository().get(
      from,
      contractToday(demoNow()),
    );
    return {
      counterpartyName: contract.counterpartyName,
      effectiveDate: contract.effectiveDate,
      ownerName: contract.ownerName,
      countersignerId: signing.countersigner.id,
      values: Object.fromEntries(
        fieldIds.map((id) => [id, signing.input[id] ?? ""]),
      ),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      ["CONTRACT_SIGNING_NOT_FOUND", "CONTRACT_NOT_FOUND"].includes(
        error.message,
      )
    )
      return null;
    throw error;
  }
}

export function loadPrepare(templateId: string, from?: string) {
  return loadWith("contract:write", async (session) => {
    const template = contractTemplateRegistry().find(
      (candidate) => candidate.id === templateId,
    );
    if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
    return {
      start:
        template.status === "available"
          ? await prepareStart(
              from,
              template.id,
              template.fields.map((field) => field.id),
            )
          : null,
      template:
        template.status === "available"
          ? {
              id: template.id,
              contractType: template.contractType,
              status: template.status,
              version: template.version,
              requiresApproval: template.requiresApproval,
              fields: template.fields,
            }
          : {
              id: template.id,
              contractType: template.contractType,
              status: template.status,
            },
      countersigners:
        template.status === "available"
          ? await contractSigningRepository().countersigners()
          : [],
      ownerName: session.profile.name,
      signingReady: contractSigningConfiguration().ready,
      testMode: contractSigningConfiguration().testMode,
      today: contractToday(demoNow()),
    };
  });
}

/** A signed MNDA the reader may open in the MNDA register, to start a
 * contract with the same counterparty. Any other id starts an empty form. */
export interface ContractFormMnda {
  id: string;
  company: string;
  signerName: string;
  /** The UTC day the MNDA was fully signed. */
  signedOn: string;
}

async function signedMnda(
  session: ContractStaffSession,
  id: string | undefined,
): Promise<ContractFormMnda | null> {
  if (!id || !z.uuid().safeParse(id).success) return null;
  if (!sessionHas(session, "mnda:send")) return null;
  try {
    const record = await mndaRepository().get(id);
    if (record.state !== "completed") return null;
    return {
      id: record.id,
      company: record.input.company,
      signerName: record.input.signerName,
      signedOn: (record.completedAt ?? record.updatedAt).slice(0, 10),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "MNDA_NOT_FOUND")
      return null;
    throw error;
  }
}

/** A record a new one replaces, such as counterparty paper whose signing
 * request closed. Anything else starts an empty form. */
async function replacedContract(id: string | undefined) {
  if (!id || !z.uuid().safeParse(id).success) return null;
  try {
    return (await contractRepository().get(id, contractToday(demoNow())))
      .contract;
  } catch (error) {
    if (error instanceof Error && error.message === "CONTRACT_NOT_FOUND")
      return null;
    throw error;
  }
}

export function loadContractForm(
  id?: string,
  mndaId?: string,
  fromId?: string,
) {
  return loadWith("contract:write", async (session) => ({
    ownerName: session.profile.name,
    today: contractToday(demoNow()),
    contract: id
      ? (await contractRepository().get(id, contractToday(demoNow()))).contract
      : null,
    mnda: id ? null : await signedMnda(session, mndaId),
    copyOf: id ? null : await replacedContract(fromId),
  }));
}
