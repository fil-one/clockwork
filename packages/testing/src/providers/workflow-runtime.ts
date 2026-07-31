import { createHash } from "node:crypto";

import type { BillingPort, ProviderResult } from "@clockwork/contracts";
import type { ExternalGateActivationTestResult } from "@clockwork/domain/system";
import type {
  AccountingExportBatch,
  AccountingExportSink,
  NotificationProviderClient,
  ResolvedBrand,
  StripeLedgerBillingPort,
  UsageProviderClient,
  WorkosClient,
  WorkosMembership,
} from "@clockwork/integrations";
import type {
  AuthoritativeLifecycleTaskStore,
  WorkflowProviderActivationGuard,
} from "@clockwork/workflows";

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24)}`;
}

export function deterministicProviderActivationTest(
  provider: string,
  testedAt = "2026-07-31T16:00:00.000Z",
): () => Promise<ExternalGateActivationTestResult> {
  return () =>
    Promise.resolve({
      status: "passed",
      testedAt,
      testedBy: "workflow-provider-simulator",
      evidenceReference: `urn:clockwork:activation:${provider}`,
      simulatorState: "ready",
      simulatorDetails: `${provider} deterministic provider simulator ready`,
    });
}

export class DeterministicWorkflowProviderActivationGuard implements WorkflowProviderActivationGuard {
  public readonly checks: { gateKeys: readonly string[]; requestId: string }[] =
    [];

  public requireActive(
    gateKeys: readonly string[],
    requestId: string,
  ): Promise<void> {
    this.checks.push({ gateKeys: [...gateKeys], requestId });
    return Promise.resolve();
  }
}

export class DeterministicBillingMeteringAdapter
  implements BillingPort, StripeLedgerBillingPort
{
  public createCustomer(input: Parameters<BillingPort["createCustomer"]>[0]) {
    return success({ customerId: stableId("cus_sim", input) });
  }

  public issueInvoice(input: Parameters<BillingPort["issueInvoice"]>[0]) {
    return success({
      providerInvoiceId: stableId("in_sim", input),
      status: "open",
    });
  }

  public createRefund(input: Parameters<BillingPort["createRefund"]>[0]) {
    return success({ refundId: stableId("re_sim", input) });
  }

  public syncOverage(
    input: Parameters<StripeLedgerBillingPort["syncOverage"]>[0],
  ) {
    return success({
      providerInvoiceItemIds: input.lines.map((line) =>
        stableId("ii_sim", {
          idempotencyKey: input.idempotencyKey,
          ledgerEntryId: line.ledgerEntryId,
        }),
      ),
      duplicateSourceUsageIds: [],
    });
  }
}

export class DeterministicAccountingExportSink implements AccountingExportSink {
  public readonly batches: AccountingExportBatch[] = [];

  public write(input: {
    readonly batch: AccountingExportBatch;
    readonly idempotencyKey: string;
  }): Promise<ProviderResult<{ externalBatchId: string }>> {
    this.batches.push(structuredClone(input.batch));
    return success({
      externalBatchId: stableId("acct_sim", input.idempotencyKey),
    });
  }
}

export class DeterministicNotificationProviderClient implements NotificationProviderClient {
  public readonly messages: {
    template: string;
    recipient: string;
    data: Readonly<Record<string, unknown>>;
    brand: ResolvedBrand;
    idempotencyKey: string;
  }[] = [];

  public send(input: {
    template: string;
    recipient: string;
    data: Readonly<Record<string, unknown>>;
    brand: ResolvedBrand;
    idempotencyKey: string;
  }): Promise<{ messageId: string }> {
    this.messages.push(structuredClone(input));
    return Promise.resolve({ messageId: stableId("msg_sim", input) });
  }
}

export class DeterministicUsageProviderClient implements UsageProviderClient {
  public readonly calls: {
    organizationId: string;
    from: string;
    to: string;
  }[] = [];

  public pull(input: { organizationId: string; from: string; to: string }) {
    this.calls.push({ ...input });
    const measuredAt = new Date(
      Date.parse(input.from) +
        (Date.parse(input.to) - Date.parse(input.from)) / 2,
    ).toISOString();
    return Promise.resolve({
      records: [
        {
          externalId: stableId("usage_sim", input),
          sku: "LOCKED-STORAGE-TB",
          quantity: "1.25",
          measuredAt,
        },
      ],
    });
  }
}

export class DeterministicAuthoritativeLifecycleTaskStore implements AuthoritativeLifecycleTaskStore {
  public readonly invocations: {
    taskId: string;
    aggregateId: string;
    scheduled: boolean;
    requestId: string;
  }[] = [];

  public run(input: {
    taskId: string;
    aggregateId: string;
    scheduled: boolean;
    requestId: string;
  }) {
    this.invocations.push(structuredClone(input));
    return Promise.resolve({
      taskId: input.taskId,
      status: "authoritative_state_loaded" as const,
      candidateIds: [input.aggregateId],
    });
  }
}

export class DeterministicWorkosClient implements WorkosClient {
  private readonly organizations = new Map<
    string,
    {
      id: string;
      name: string;
      externalId: string;
      verifiedDomains: string[];
      mfaPolicy: "required" | "inherited_from_sso";
    }
  >();
  private readonly memberships = new Map<string, WorkosMembership[]>();

  public createOrganization(input: {
    name: string;
    externalId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    const id = stableId("org_sim", input.idempotencyKey);
    if (!this.organizations.has(id))
      this.organizations.set(id, {
        id,
        name: input.name,
        externalId: input.externalId,
        verifiedDomains: [],
        mfaPolicy: "required",
      });
    return Promise.resolve({ id });
  }

  public addVerifiedDomain(input: {
    organizationId: string;
    domain: string;
    verificationToken: string;
  }): Promise<{ verified: boolean }> {
    const organization = this.organizations.get(input.organizationId);
    if (!organization) throw new Error("WORKOS_SIM_ORGANIZATION_NOT_FOUND");
    const verified = input.verificationToken === `verify:${input.domain}`;
    if (verified)
      organization.verifiedDomains = [
        ...new Set([...organization.verifiedDomains, input.domain]),
      ];
    return Promise.resolve({ verified });
  }

  public updateMfaPolicy(input: {
    organizationId: string;
    policy: "required" | "inherited_from_sso";
    idempotencyKey: string;
  }): Promise<void> {
    const organization = this.organizations.get(input.organizationId);
    if (!organization) throw new Error("WORKOS_SIM_ORGANIZATION_NOT_FOUND");
    organization.mfaPolicy = input.policy;
    return Promise.resolve();
  }

  public createInvitation(input: {
    organizationId: string;
    email: string;
    roleSlug: string;
    idempotencyKey: string;
  }): Promise<{ id: string; state: "pending" }> {
    if (!this.organizations.has(input.organizationId))
      throw new Error("WORKOS_SIM_ORGANIZATION_NOT_FOUND");
    return Promise.resolve({
      id: stableId("invite_sim", input.idempotencyKey),
      state: "pending",
    });
  }

  public listMemberships(input: { organizationId: string }) {
    return Promise.resolve([
      ...(this.memberships.get(input.organizationId) ?? []),
    ]);
  }

  public getOrganization(input: { organizationId: string }) {
    const organization = this.organizations.get(input.organizationId);
    if (!organization) throw new Error("WORKOS_SIM_ORGANIZATION_NOT_FOUND");
    return Promise.resolve({ ...organization });
  }
}

function success<T>(value: T): Promise<ProviderResult<T>> {
  return Promise.resolve({ ok: true, value });
}
