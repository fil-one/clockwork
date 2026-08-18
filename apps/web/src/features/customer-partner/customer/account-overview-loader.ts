import "server-only";

import type { DemoAdapterStateStore } from "@clockwork/testing/demo-state";

import { demoAccountRecord } from "@/src/features/experience-server/demo-account-controls";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

export interface AccountOverviewAccount {
  readonly accountName: string;
  readonly billingContact?: string;
  readonly invoiceDeliveryEmail?: string;
}

export async function loadAccountOverviewAccount(input: {
  readonly accountId: string;
  readonly identityAccountName: string;
  readonly guidedDemo: boolean;
  readonly store?: DemoAdapterStateStore;
}): Promise<AccountOverviewAccount> {
  if (!input.guidedDemo) return { accountName: input.identityAccountName };
  const account = demoAccountRecord(
    await (input.store ?? configuredDemoStateStore()).read(),
    input.accountId,
  );
  return {
    accountName: account.legalName,
    billingContact: `${account.billingContact.name} · ${account.billingContact.email}`,
    invoiceDeliveryEmail: account.invoiceDeliveryEmail,
  };
}
