import { createHash } from "node:crypto";

import type {
  CoreRouteDependencies,
  LifecycleRouteDependencies,
} from "@clockwork/api";
import {
  DatabaseActiveAgreementTemplateRepository,
  DatabaseCustomerPaymentTargetRepository,
  DatabaseExternalGateService,
  DatabaseEsignSigningSessionRepository,
  DatabaseImmutableArtifactRepository,
  DatabaseStripeFinancialProjection,
  DatabaseVerifiedPartnerOriginRepository,
  type LifecycleMigrationSourcePort,
  type RuntimeDatabase,
} from "@clockwork/db";
import { ProblemError, type WebhookVerifier } from "@clockwork/contracts";
import {
  normalizedStripeEventFromPayload,
  type DomainOwnershipVerifier,
  type EsignSigningClient,
  type ImmutableArtifactReader,
  type MigrationSnapshotSource,
  type StripeInvoicePaymentSessionGateway,
} from "@clockwork/integrations";

type PaymentSessionService = NonNullable<
  CoreRouteDependencies["paymentSessions"]
>;
type ArtifactService = NonNullable<CoreRouteDependencies["artifacts"]>;
type ActiveTemplateService = NonNullable<
  LifecycleRouteDependencies["activeAgreementTemplates"]
>;
type SigningSessionService = NonNullable<
  LifecycleRouteDependencies["signingSessions"]
>;
type RegistrationBootstrapVerifier = NonNullable<
  LifecycleRouteDependencies["registrationBootstrap"]
>;
type ExternalGateKey = Awaited<
  ReturnType<DatabaseExternalGateService["list"]>
>[number]["gateKey"];

export class PersistedExternalGateGuard {
  private readonly gates: DatabaseExternalGateService;

  public constructor(database: RuntimeDatabase) {
    this.gates = new DatabaseExternalGateService(database);
  }

  public async requireActive(
    gateKeys: readonly ExternalGateKey[],
    requestId: string,
  ): Promise<void> {
    let views: Awaited<ReturnType<DatabaseExternalGateService["list"]>>;
    try {
      views = await this.gates.list({ requestId, now: new Date() });
    } catch {
      throw new ProblemError({
        type: "https://clockwork.test/problems/external-gate-unavailable",
        // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
        title: "External provider activation register is unavailable",
        status: 503,
        code: "EXTERNAL_GATE_SERVICE_UNAVAILABLE",
        requestId,
        retryable: true,
      });
    }
    const byKey = new Map(views.map((gate) => [gate.gateKey, gate]));
    const blocked = gateKeys.filter(
      (gateKey) => byKey.get(gateKey)?.activationAllowed !== true,
    );
    if (blocked.length === 0) return;
    throw new ProblemError({
      type: "https://clockwork.test/problems/external-gate-inactive",
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      title: "External provider activation gate is not active",
      status: 503,
      code: "EXTERNAL_GATE_INACTIVE",
      requestId,
      // i18n-exempt: API problem text for API callers; the UI words failures from status and code (contracts/error-text.ts)
      detail: `Required activation gates are inactive: ${blocked.join(", ")}`,
      retryable: false,
    });
  }
}

export interface ExternalGateGuard {
  requireActive(
    gateKeys: readonly ExternalGateKey[],
    requestId: string,
  ): Promise<void>;
}

/** Production stays closed until a scoped, audited migration source is injected. */
export class FailClosedProductionMigrationSource implements LifecycleMigrationSourcePort {
  public load(): Promise<never> {
    return Promise.reject(
      new Error("PRODUCTION_MIGRATION_SOURCE_NOT_ACTIVATED"),
    );
  }
}

export class GateCheckedProductionMigrationSource implements LifecycleMigrationSourcePort {
  public constructor(
    private readonly source: MigrationSnapshotSource,
    private readonly guard: ExternalGateGuard,
  ) {}

  public async load(
    input: Parameters<LifecycleMigrationSourcePort["load"]>[0],
  ) {
    await this.guard.requireActive(["EXT-MIGRATION-01"], input.requestId);
    const snapshot = await this.source.load(input);
    return { sourceKind: "real_snapshot" as const, ...snapshot };
  }
}

export class GateCheckedWebhookVerifier<T> implements WebhookVerifier<T> {
  public constructor(
    private readonly verifier: WebhookVerifier<T>,
    private readonly guard: ExternalGateGuard,
    private readonly gateKeys: readonly ExternalGateKey[],
  ) {}

  public async verify(input: Parameters<WebhookVerifier<T>["verify"]>[0]) {
    await this.guard.requireActive(this.gateKeys, crypto.randomUUID());
    return this.verifier.verify(input);
  }
}

export class GateCheckedRegistrationBootstrap implements RegistrationBootstrapVerifier {
  public constructor(
    private readonly bootstrap: RegistrationBootstrapVerifier,
    private readonly guard: ExternalGateGuard,
  ) {}

  public async verify(
    input: Parameters<RegistrationBootstrapVerifier["verify"]>[0],
  ) {
    await this.guard.requireActive(
      ["EXT-ACC-01", "EXT-DOMAIN-01"],
      input.requestId,
    );
    return this.bootstrap.verify(input);
  }
}

export class GateCheckedDomainOwnershipVerifier implements DomainOwnershipVerifier {
  public constructor(
    private readonly verifier: DomainOwnershipVerifier,
    private readonly guard: ExternalGateGuard,
  ) {}

  public async verify(input: Parameters<DomainOwnershipVerifier["verify"]>[0]) {
    await this.guard.requireActive(
      ["EXT-ACC-01", "EXT-DOMAIN-01"],
      input.requestId,
    );
    return this.verifier.verify(input);
  }
}

export class ProductionVerifiedPartnerOriginResolver {
  private readonly origins: DatabaseVerifiedPartnerOriginRepository;

  public constructor(
    database: RuntimeDatabase,
    private readonly guard: ExternalGateGuard,
  ) {
    this.origins = new DatabaseVerifiedPartnerOriginRepository(database);
  }

  public async isAllowed(input: { origin: string; requestId: string }) {
    await this.guard.requireActive(
      ["EXT-ACC-01", "EXT-DOMAIN-01"],
      input.requestId,
    );
    return this.origins.isAllowed(input);
  }
}

export class ProductionCustomerPaymentSessionService implements PaymentSessionService {
  private readonly targets: DatabaseCustomerPaymentTargetRepository;

  public constructor(
    database: RuntimeDatabase,
    authorizationSecret: string,
    private readonly stripe: StripeInvoicePaymentSessionGateway,
    private readonly gateGuard: ExternalGateGuard,
  ) {
    this.targets = new DatabaseCustomerPaymentTargetRepository(
      database,
      authorizationSecret,
    );
  }

  public async create(input: Parameters<PaymentSessionService["create"]>[0]) {
    await this.gateGuard.requireActive(["EXT-ACC-01"], input.requestId);
    const target = await this.targets.resolve(input);
    const session = await this.stripe.create({
      stripeInvoiceId: target.stripeInvoiceId,
      stripeCustomerId: target.stripeCustomerId,
    });
    return {
      ...session,
      invoiceId: target.invoiceId,
    };
  }
}

export class ProductionStripeWebhookProjection {
  private readonly projection: DatabaseStripeFinancialProjection;

  public constructor(database: RuntimeDatabase) {
    this.projection = new DatabaseStripeFinancialProjection(database);
  }

  public apply(payload: unknown): Promise<void> {
    return this.projection.apply(normalizedStripeEventFromPayload(payload));
  }
}

export class ProductionEsignSigningSessionService implements SigningSessionService {
  private readonly sessions: DatabaseEsignSigningSessionRepository;

  public constructor(
    database: RuntimeDatabase,
    private readonly reader: ImmutableArtifactReader,
    private readonly client: EsignSigningClient,
    private readonly gateGuard: ExternalGateGuard,
  ) {
    this.sessions = new DatabaseEsignSigningSessionRepository(database);
  }

  public async create(input: Parameters<SigningSessionService["create"]>[0]) {
    await this.gateGuard.requireActive(
      ["EXT-ACC-01", "EXT-PROVIDER-01", "EXT-DOMAIN-01"],
      input.context.requestId,
    );
    if (!input.context.idempotencyKey)
      throw new Error("E_SIGNING_IDEMPOTENCY_KEY_REQUIRED");
    const target = await this.sessions.load({
      envelopeId: input.envelope.id,
      accountId: input.request.accountId,
      documentId: input.request.documentId,
      requestId: input.context.requestId,
    });
    const artifact = await this.reader.read(target);
    const created = await this.client.createEnvelope({
      externalReference: target.envelopeId,
      accountId: target.accountId,
      documentId: target.documentId,
      documentBytes: artifact.bytes,
      documentSha256: artifact.contentHash,
      signerEmail: target.signerEmail,
      mode: target.mode,
      returnUrl: target.returnUrl,
      idempotencyKey: input.context.idempotencyKey,
    });
    await this.sessions.persistProviderBinding({
      envelopeId: target.envelopeId,
      expectedProviderEnvelopeId: target.providerEnvelopeId,
      providerEnvelopeId: created.id,
      state: created.state,
      requestId: input.context.requestId,
    });
    return {
      ...input.envelope,
      providerEnvelopeId: created.id,
      status: created.state,
      signingUrl: created.signingUrl,
    };
  }
}

export class ProductionImmutableArtifactService implements ArtifactService {
  private readonly artifacts: DatabaseImmutableArtifactRepository;

  public constructor(
    database: RuntimeDatabase,
    serviceDatabase: RuntimeDatabase,
    authorizationSecret: string,
    private readonly reader: ImmutableArtifactReader,
    private readonly gateGuard: ExternalGateGuard,
  ) {
    this.artifacts = new DatabaseImmutableArtifactRepository(
      database,
      serviceDatabase,
      authorizationSecret,
    );
  }

  public async read(input: Parameters<ArtifactService["read"]>[0]) {
    await this.gateGuard.requireActive(["EXT-ACC-01"], input.requestId);
    const metadata = await this.artifacts.find(input);
    if (
      input.artifactKind !== "agreement_template" &&
      metadata.accountId !== input.accountId
    )
      // i18n-exempt: server invariant; the API answers 500 INTERNAL_ERROR and omits this text in production
      throw new Error("Artifact account binding mismatch");
    const artifact = await this.reader.read(metadata);
    const extension = artifact.mimeType === "application/pdf" ? "pdf" : "bin";
    return {
      ...artifact,
      filename: `${input.artifactKind}-${input.artifactId}.${extension}`,
    };
  }
}

export class ProductionActiveAgreementTemplateService implements ActiveTemplateService {
  private readonly templates: DatabaseActiveAgreementTemplateRepository;

  public constructor(
    database: RuntimeDatabase,
    authorizationSecret: string,
    private readonly gateGuard: ExternalGateGuard,
  ) {
    this.templates = new DatabaseActiveAgreementTemplateRepository(
      database,
      authorizationSecret,
    );
  }

  public async getActive(
    input: Parameters<ActiveTemplateService["getActive"]>[0],
  ) {
    await this.gateGuard.requireActive(["EXT-LEGAL-01"], input.requestId);
    const template = await this.templates.getActive(input);
    const exactHash = createHash("sha256")
      .update(template.exactText, "utf8")
      .digest("hex");
    if (exactHash !== template.exactTextHash)
      throw new Error(
        // i18n-exempt: server invariant; the API answers 500 INTERNAL_ERROR and omits this text in production
        "Agreement exact text does not match the approved template",
      );
    if (!template.exactText.trim())
      // i18n-exempt: server invariant; the API answers 500 INTERNAL_ERROR and omits this text in production
      throw new Error("Agreement exact text is empty");
    return {
      ...template,
      executionMode:
        template.executionMode === "counter_signed"
          ? ("counter_signed" as const)
          : ("click_through" as const),
    };
  }
}
