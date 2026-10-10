import "server-only";
import {
  ContractListQuerySchema,
  contractRenewalWindows,
  type ContractListQuery,
  type Permission,
} from "@clockwork/contracts";
import { contractToday } from "@clockwork/domain/contract-terms";
import { contractReader, contractRegisterReader } from "./demo-access";
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
    const session = await contractReader(permission);
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

/** Signed MNDAs join the register only for people who may open MNDAs. */
export const listScope = (session: ContractStaffSession) => ({
  includeMndas: sessionHas(session, "mnda:send"),
});

export function loadRegister(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return loadWith("contract:read", async (session) => {
    const query: ContractListQuery =
      ContractListQuerySchema.parse(searchParams);
    const today = contractToday();
    return {
      query,
      today,
      result: await contractRegisterReader().list(
        query,
        today,
        listScope(session),
      ),
      canOpenMndas: listScope(session).includeMndas,
      ...permissions(session),
    };
  });
}

export function loadContract(id: string) {
  return loadWith("contract:read", async (session) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("CONTRACT_NOT_FOUND");
    const today = contractToday();
    const detail = await contractRegisterReader().get(id, today);
    return {
      ...detail,
      today,
      ...permissions(session),
      isPreparer: detail.signing?.preparerId === session.userId,
      signingReady: contractSigningConfiguration().ready,
    };
  });
}

export function loadRenewals(window: unknown) {
  return loadWith("contract:read", async () => {
    const days =
      contractRenewalWindows.find((w) => String(w) === String(window)) ?? 90;
    const today = contractToday();
    const repository = contractRegisterReader();
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

export function loadPrepare(templateId: string) {
  return loadWith("contract:write", async (session) => {
    const template = contractTemplateRegistry().find(
      (candidate) => candidate.id === templateId,
    );
    if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
    return {
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
      today: contractToday(),
    };
  });
}

export function loadContractForm(id?: string) {
  return loadWith("contract:write", async (session) => ({
    ownerName: session.profile.name,
    today: contractToday(),
    contract: id
      ? (await contractRepository().get(id, contractToday())).contract
      : null,
  }));
}
