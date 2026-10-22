import type { AccountDocumentTarget } from "@clockwork/contracts";
import { InlineNotice } from "@clockwork/ui";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { getTranslations } from "@/src/i18n/server";
import { sessionHas, ContractAccessError } from "../contracts/server";
import { AccountDocuments } from "./documents";
import { accountDocumentRepository, accountDocumentStaff } from "./server";

/** A failure to load attachments never hides the rest of the account. */
export async function AccountDocumentsSection({
  target,
}: {
  target: AccountDocumentTarget;
}) {
  const t = await getTranslations();
  if (explicitDemoIdentityEnabled())
    return (
      <AccountDocuments target={target} files={[]} canWrite={false} demo />
    );
  try {
    const session = await accountDocumentStaff(target);
    const files = await accountDocumentRepository().list(target);
    return (
      <AccountDocuments
        target={target}
        files={files}
        canWrite={sessionHas(session, "contract:write")}
      />
    );
  } catch (error) {
    if (error instanceof ContractAccessError) return null;
    console.error("Account documents could not be loaded", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return (
      <InlineNotice
        tone="danger"
        title={t("operations.accountDocuments.unavailable")}
      />
    );
  }
}
