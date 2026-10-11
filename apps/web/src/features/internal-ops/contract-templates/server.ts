import "server-only";
import {
  templateVersionLabel,
  type ContractTemplateVersionRecord,
  type TemplateContent,
} from "@clockwork/contracts";
import {
  demoContractTemplateFiles,
  templateContentHash,
  TemplateContentSchema,
} from "@clockwork/documents";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  type CommerceSession,
} from "@/src/auth/session";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import {
  ContractAccessError,
  contractStaff,
  contractTemplateRepository,
  sessionHas,
} from "../contracts/server";

/**
 * Who may manage templates: a commerce administrator in a verified staff
 * session (`contract_template:manage`). In the guided demo the same persona
 * reads the sample templates and checks a file; every save is refused.
 */
export async function templateAdmin(
  readSession: () => Promise<CommerceSession> = getCommerceSession,
) {
  if (!explicitDemoIdentityEnabled())
    return {
      session: await contractStaff("contract_template:manage", readSession),
      demo: false,
    };
  const session = await readSession();
  if (
    !session.isInternalStaff ||
    session.impersonation ||
    session.assistedSession ||
    !sessionHas(session, "contract_template:manage")
  )
    throw new ContractAccessError("CONTRACT_FORBIDDEN");
  return { session, demo: true };
}

/** A write: refused in the guided demo, as every contract write is. */
export async function templateAdminWriter() {
  const admin = await templateAdmin();
  if (admin.demo) throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  return {
    ...admin,
    actor: {
      kind: "user" as const,
      id: admin.session.userId,
      display: admin.session.profile.name,
    },
  };
}

/** The demo's sample templates, read as active versions of the store. */
export function demoTemplateRecords(): ContractTemplateVersionRecord[] {
  const at = demoNow().toISOString();
  return demoContractTemplateFiles.map((file, index) => {
    const content: TemplateContent = TemplateContentSchema.parse(
      Object.fromEntries(
        Object.entries(file).filter(([key]) => key !== "version"),
      ),
    );
    return {
      id: demoTemplateRecordId(index),
      key: content.id,
      version: 1,
      versionLabel: templateVersionLabel(1),
      name: content.name,
      contractType: content.contractType,
      status: "active",
      sourceNote: content.sourceNote ?? "",
      contentHash: templateContentHash(content),
      createdByName: "Elena Brooks",
      createdAt: at,
      updatedAt: at,
      activatedByName: "Elena Brooks",
      activatedAt: at,
      retiredByName: null,
      retiredAt: null,
      revision: 2,
      content,
      problem: null,
      usedBy: 0,
    };
  });
}

const demoTemplateRecordId = (index: number) =>
  `00000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, "0")}`;

export { contractTemplateRepository };
