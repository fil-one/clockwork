import { createHash } from "node:crypto";

import type {
  AccountingPort,
  BillingPort,
  CrmPort,
  EvidenceStoragePort,
  NotificationPort,
  OrchestratorUsagePort,
  ProviderPorts,
  ProvisioningPort,
  ScreeningPort,
  SignaturePort,
  SupportFeedPort,
  TaxDeterminationPort,
  TaxPort,
  WebhookVerifier,
  WebhookVerificationResult,
} from "@clockwork/contracts";
import { ids, MoneySchema } from "@clockwork/contracts";
import { taxOnNet, type TaxRuleBook } from "@clockwork/domain/core";

import { RuleBookTaxDeterminationAdapter } from "../core/tax/rule-book-adapter";
import { seedTaxRuleBook } from "../core/tax/seed-rule-book";
import { FakeProviderKernel } from "./scenario";

const stableReference = (prefix: string, value: unknown) => {
  const text = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (const char of text)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619);
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export class FakeBillingAdapter implements BillingPort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public createCustomer(input: Parameters<BillingPort["createCustomer"]>[0]) {
    return this.kernel.execute("billing.createCustomer", input, () => ({
      customerId: stableReference("cus_fake", input),
    }));
  }
  public issueInvoice(input: Parameters<BillingPort["issueInvoice"]>[0]) {
    return this.kernel.execute("billing.issueInvoice", input, () => ({
      providerInvoiceId: stableReference("in_fake", input),
      status: "open",
    }));
  }
  public createRefund(input: Parameters<BillingPort["createRefund"]>[0]) {
    return this.kernel.execute("billing.createRefund", input, () => ({
      refundId: stableReference("re_fake", input),
    }));
  }
}

export class FakeSignatureAdapter implements SignaturePort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public createEnvelope(input: Parameters<SignaturePort["createEnvelope"]>[0]) {
    return this.kernel.execute("signature.createEnvelope", input, () => {
      const envelopeId = stableReference("env_fake", input);
      return {
        envelopeId,
        signingUrl: `https://signing.clockwork.test/${envelopeId}`,
      };
    });
  }
  public downloadCompletedDocument(envelopeId: string) {
    return this.kernel.execute(
      "signature.downloadCompletedDocument",
      { envelopeId },
      () => ({
        bytes: new TextEncoder().encode(`signed:${envelopeId}`),
        certificate: new TextEncoder().encode(`certificate:${envelopeId}`),
      }),
    );
  }
}

export class FakeProvisioningAdapter implements ProvisioningPort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public provision(input: Parameters<ProvisioningPort["provision"]>[0]) {
    return this.kernel.execute("provisioning.provision", input, () => ({
      operationId: stableReference("provision_fake", input),
    }));
  }
  public teardown(input: Parameters<ProvisioningPort["teardown"]>[0]) {
    if (input.approvalIds[0] === input.approvalIds[1]) {
      return Promise.resolve({
        ok: false,
        kind: "permanent",
        code: "TWO_PERSON_REQUIRED",
        message: "Two distinct approval IDs are required",
      } as const);
    }
    return this.kernel.execute("provisioning.teardown", input, () => ({
      operationId: stableReference("teardown_fake", input),
    }));
  }
}

export class FakeCrmAdapter implements CrmPort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public projectEvent(event: Parameters<CrmPort["projectEvent"]>[0]) {
    return this.kernel.execute("crm.projectEvent", event, () => ({
      projectionId: stableReference("crm_fake", event),
    }));
  }
}

export class FakeAccountingAdapter implements AccountingPort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public postInvoice(input: Parameters<AccountingPort["postInvoice"]>[0]) {
    return this.kernel.execute("accounting.postInvoice", input, () => ({
      postingId: stableReference("posting_fake", input),
    }));
  }
  public postCommissionBill(
    input: Parameters<AccountingPort["postCommissionBill"]>[0],
  ) {
    return this.kernel.execute("accounting.postCommissionBill", input, () => ({
      billId: stableReference("bill_fake", input),
    }));
  }
}

export class FakeScreeningAdapter implements ScreeningPort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public screen(input: Parameters<ScreeningPort["screen"]>[0]) {
    return this.kernel.execute("screening.screen", input, () => ({
      decision: "clear" as const,
      reference: stableReference("screen_fake", input),
    }));
  }
}

/**
 * Legacy fixture for the deprecated {@link TaxPort}. It carries the rates and
 * the jurisdiction lists so no rate and no country rule is written into shipped
 * code. It cannot be made correct — `TaxPort.calculate` has no supplier, so no
 * place-of-supply rule can be applied to it — and it exists only until the last
 * caller moves to {@link FakeTaxAdapter.determine}.
 */
export interface FakeTaxFixture {
  /** Basis points by tax code. An absent code is zero-rated, not refused. */
  readonly rateBasisPoints?: Readonly<Record<string, number>>;
  readonly reverseChargeJurisdictions?: readonly string[];
  readonly exemptJurisdictions?: readonly string[];
  /** Identifier prefixes the fixture treats as reverse-charge registrations. */
  readonly reverseChargeIdentifierPrefixes?: readonly string[];
}

/**
 * The fake tax provider, which is the real determination engine.
 *
 * `determine` and the new `validateTaxId` run `@clockwork/domain`'s engine
 * against a seeded rule book, so the fake and production differ only in where
 * the rule book came from — one implementation of every rule, nothing to drift.
 * That is what makes tax testable today rather than after `EXT-TAX-01`: the
 * rates in the seed are fixture data and a pass here is not an activation pass,
 * but the reverse-charge, place-of-supply and rounding behaviour under test is
 * the behaviour that ships.
 *
 * The deprecated `calculate` stays fixture-driven on purpose. Routing it
 * through the engine would mean inventing the supplier its signature omits,
 * which is the defect, not the fix.
 */
export class FakeTaxAdapter implements TaxPort, TaxDeterminationPort {
  private readonly engine: RuleBookTaxDeterminationAdapter;

  public constructor(
    private readonly kernel: FakeProviderKernel,
    private readonly fixture: FakeTaxFixture = {},
    ruleBooks: TaxRuleBook | readonly TaxRuleBook[] = seedTaxRuleBook(),
  ) {
    this.engine = new RuleBookTaxDeterminationAdapter(ruleBooks);
  }

  public async determine(
    input: Parameters<TaxDeterminationPort["determine"]>[0],
  ): Promise<Awaited<ReturnType<TaxDeterminationPort["determine"]>>> {
    const scenario = await this.kernel.execute("tax.determine", input, () =>
      this.engine.determine(input),
    );
    return scenario.ok ? scenario.value : scenario;
  }

  public validateTaxId(
    input: Parameters<TaxDeterminationPort["validateTaxId"]>[0],
  ): Promise<Awaited<ReturnType<TaxDeterminationPort["validateTaxId"]>>>;
  public validateTaxId(
    input: Parameters<TaxPort["validateTaxId"]>[0],
  ): Promise<Awaited<ReturnType<TaxPort["validateTaxId"]>>>;
  public async validateTaxId(input: {
    country: string;
    value: string;
    checkedAt?: string;
  }): Promise<
    | Awaited<ReturnType<TaxDeterminationPort["validateTaxId"]>>
    | Awaited<ReturnType<TaxPort["validateTaxId"]>>
  > {
    // The deprecated port omits `checkedAt`, and a validation with no date is
    // exactly the evidence the EU asks for and does not get. The legacy shape
    // keeps answering, without inventing a date it was never told.
    if (input.checkedAt === undefined)
      return this.kernel.execute("tax.validateTaxId", input, () => {
        const normalized = input.value.replace(/\s/g, "").toUpperCase();
        return {
          valid: input.value.length >= 5,
          normalized,
          reverseChargeEligible: (
            this.fixture.reverseChargeIdentifierPrefixes ?? []
          ).some((prefix) => normalized.startsWith(prefix.toUpperCase())),
        };
      });
    const checkedAt = input.checkedAt;
    const scenario = await this.kernel.execute("tax.validateTaxId", input, () =>
      this.engine.validateTaxId({
        country: input.country,
        value: input.value,
        checkedAt,
      }),
    );
    return scenario.ok ? scenario.value : scenario;
  }

  /** @deprecated Determines against the invoiced account; use `determine`. */
  public calculate(input: Parameters<TaxPort["calculate"]>[0]) {
    return this.kernel.execute("tax.calculate", input, () => {
      const jurisdiction = input.jurisdiction.toUpperCase();
      const treatment = (
        this.fixture.reverseChargeJurisdictions ?? []
      ).includes(jurisdiction)
        ? ("reverse_charge" as const)
        : (this.fixture.exemptJurisdictions ?? []).includes(jurisdiction)
          ? ("exempt" as const)
          : ("standard" as const);
      // Only a standard supply carries an amount, and the rounding is the
      // engine's own `taxOnNet`: half away from zero, so a credit line's
      // negative tax is the mirror of the charge it reverses. Sharing the
      // primitive is the point — two roundings is two answers.
      const minor =
        treatment === "standard"
          ? input.lines.reduce(
              (total, line) =>
                total +
                taxOnNet(
                  BigInt(line.amount.minor),
                  (this.fixture.rateBasisPoints?.[line.taxCode] ?? 0) * 100,
                ),
              0n,
            )
          : 0n;
      return {
        tax: MoneySchema.parse({
          currency: input.lines[0]?.amount.currency ?? "USD",
          minor: minor.toString(),
        }),
        treatment,
      };
    });
  }
}

export class FakeEvidenceStorageAdapter implements EvidenceStoragePort {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentHash: string }
  >();
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public putImmutable(
    input: Parameters<EvidenceStoragePort["putImmutable"]>[0],
  ) {
    const actualHash = createHash("sha256").update(input.bytes).digest("hex");
    if (actualHash !== input.contentHash)
      return Promise.resolve({
        ok: false,
        kind: "permanent",
        code: "CONTENT_HASH_MISMATCH",
        message: "Evidence bytes do not match the declared SHA-256 hash",
      } as const);
    return this.kernel.execute("evidence.putImmutable", input, () => {
      const suffix = stableReference("", input.contentHash)
        .replace("_", "")
        .padEnd(12, "0")
        .slice(0, 12);
      const documentId = ids.document.parse(
        `40000000-0000-4000-8000-${suffix}`,
      );
      const existing = this.objects.get(documentId);
      if (existing && existing.contentHash !== input.contentHash)
        throw new Error("Immutable fake evidence collision");
      this.objects.set(documentId, {
        bytes: input.bytes.slice(),
        contentHash: input.contentHash,
      });
      return {
        documentId,
        storageKey: `sha256/${input.contentHash}`,
        versionId: stableReference("version_fake", input),
      };
    });
  }
  public get(documentId: Parameters<EvidenceStoragePort["get"]>[0]) {
    return this.kernel.execute("evidence.get", { documentId }, () => {
      const object = this.objects.get(documentId);
      if (!object)
        throw new Error(`Missing fake evidence object ${documentId}`);
      return { bytes: object.bytes.slice(), contentHash: object.contentHash };
    });
  }
}

export class FakeNotificationAdapter implements NotificationPort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public send(input: Parameters<NotificationPort["send"]>[0]) {
    return this.kernel.execute("notifications.send", input, () => ({
      messageId: stableReference("msg_fake", input),
    }));
  }
}

export class FakeSupportFeedAdapter implements SupportFeedPort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public listSignals(input: Parameters<SupportFeedPort["listSignals"]>[0]) {
    return this.kernel.execute(
      "support.listSignals",
      input,
      () =>
        [
          {
            externalId: stableReference("ticket_fake", input),
            severity: "low",
            openedAt: "2026-07-31T16:00:00.000Z",
            status: "open",
          },
        ] as const,
    );
  }
}

export class FakeUsageAdapter implements OrchestratorUsagePort {
  public constructor(private readonly kernel: FakeProviderKernel) {}
  public pullUsage(input: Parameters<OrchestratorUsagePort["pullUsage"]>[0]) {
    return this.kernel.execute(
      "usage.pullUsage",
      input,
      () =>
        [
          {
            externalId: stableReference("usage_fake", input),
            sku: "LOCKED-STORAGE-TB",
            quantity: "1.25",
            measuredAt: input.to,
          },
        ] as const,
    );
  }
}

export class FakeWebhookVerifier<T> implements WebhookVerifier<T> {
  public constructor(
    private readonly parse: (raw: Uint8Array) => T,
    private readonly secret = "fake-signature",
  ) {}
  public verify(
    input: Parameters<WebhookVerifier<T>["verify"]>[0],
  ): Promise<WebhookVerificationResult<T>> {
    if (input.signature !== this.secret)
      throw new Error("Invalid fake webhook signature");
    const payload = this.parse(input.rawBody);
    return Promise.resolve({
      eventId: stableReference("evt_fake", payload),
      occurredAt: "2026-07-31T16:00:00.000Z",
      payload,
    });
  }
}

export function createFakeProviderPorts(
  kernel = new FakeProviderKernel(),
): ProviderPorts & { kernel: FakeProviderKernel } {
  const taxAdapter = new FakeTaxAdapter(kernel);
  return {
    kernel,
    billing: new FakeBillingAdapter(kernel),
    signature: new FakeSignatureAdapter(kernel),
    provisioning: new FakeProvisioningAdapter(kernel),
    crm: new FakeCrmAdapter(kernel),
    accounting: new FakeAccountingAdapter(kernel),
    screening: new FakeScreeningAdapter(kernel),
    tax: taxAdapter,
    taxDetermination: taxAdapter,
    evidence: new FakeEvidenceStorageAdapter(kernel),
    notifications: new FakeNotificationAdapter(kernel),
    support: new FakeSupportFeedAdapter(kernel),
    usage: new FakeUsageAdapter(kernel),
  };
}
