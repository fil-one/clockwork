import {
  createApiApp,
  createExternalGateActivationSimulator,
  DatabaseCoreFinanceService,
  DatabaseIdempotencyStore,
  TransactionalLifecycleService,
  type IdempotencyStore,
} from "@clockwork/api";
import {
  DatabaseEsignEnvelopeLookup,
  DatabaseExternalGateService,
  DatabaseLifecycleCommandRepository,
  DatabaseLifecycleAuthorizationScopeResolver,
  DatabaseMarketplaceWebhookBindingStore,
  DatabaseProviderResourceBindingStore,
  DatabaseProvisioningExpectationLookup,
  DatabaseRoleSynchronizationSink,
  DatabaseWebhookDeduplicator,
  type DatabaseLifecyclePolicies,
} from "@clockwork/db";
import {
  DnsTxtDomainOwnershipVerifier,
  EsignWebhookVerifier,
  FetchJsonProviderTransport,
  HttpEsignSigningClient,
  HttpMigrationSnapshotSource,
  MarketplaceWebhookVerifier,
  NormalizedStripeFinancialWebhookVerifier,
  ProvisioningWebhookVerifier,
  S3ImmutableArtifactReader,
  StripeFinancialWebhookVerifier,
  StripeInvoicePaymentSessionGateway,
  WorkosAuthorizationCodeExchange,
  WorkosRegistrationBootstrapVerifier,
  WorkosWebhookVerifier,
} from "@clockwork/integrations";

import { WorkosNextSessionResolver } from "@/src/auth/session";
import {
  getOptionalRuntimeDatabase,
  getOptionalServiceDatabase,
} from "@/src/db/service";
import {
  FailClosedProductionMigrationSource,
  GateCheckedProductionMigrationSource,
  GateCheckedRegistrationBootstrap,
  GateCheckedDomainOwnershipVerifier,
  GateCheckedWebhookVerifier,
  PersistedExternalGateGuard,
  ProductionActiveAgreementTemplateService,
  ProductionCustomerPaymentSessionService,
  ProductionEsignSigningSessionService,
  ProductionImmutableArtifactService,
  ProductionStripeWebhookProjection,
  ProductionVerifiedPartnerOriginResolver,
} from "@/src/providers/composition";

function configuredEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function queueName(value: unknown) {
  switch (value) {
    case "pricing":
    case "legal":
    case "credit_collections":
    case "restricted_parties":
    case "disputes":
    case "deal_registration_disputes":
    case "poc_qualification":
      return value;
    default:
      throw new Error("Lifecycle exception queue name is invalid");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Lifecycle policy must be an object");
  return Object.fromEntries(Object.entries(value));
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Lifecycle policy ${name} is required`);
  return value;
}

function lifecyclePolicies(): DatabaseLifecyclePolicies | undefined {
  const threshold = process.env.CLICK_THROUGH_THRESHOLD_MINOR;
  const serialized = process.env.LIFECYCLE_EXCEPTION_QUEUE_POLICIES_JSON;
  if (!threshold || !serialized) return undefined;
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed))
    throw new Error("Lifecycle exception queue policies must be an array");
  return {
    clickThroughThresholdMinor: threshold,
    migrationFeatureEnabled: process.env.MIGRATION_FEATURE_ENABLED === "true",
    automatedTeardownEnabled: process.env.AUTOMATED_TEARDOWN_ENABLED === "true",
    exceptionQueues: parsed.map((value) => {
      const item = record(value);
      if (
        typeof item.targetBusinessHours !== "number" ||
        !Number.isInteger(item.targetBusinessHours)
      )
        throw new Error("Lifecycle queue targetBusinessHours is invalid");
      return {
        queue: queueName(item.queue),
        ownerId: nonEmptyString(item.ownerId, "ownerId"),
        backupId: nonEmptyString(item.backupId, "backupId"),
        targetBusinessHours: item.targetBusinessHours,
        escalationOwnerId: nonEmptyString(
          item.escalationOwnerId,
          "escalationOwnerId",
        ),
        separationRequired: item.separationRequired === true,
      };
    }),
  };
}

const serviceDatabase = getOptionalServiceDatabase();
const runtimeDatabase = getOptionalRuntimeDatabase();
const authorizationSecret = configuredEnvironment(
  "AUTHORIZATION_CONTEXT_SECRET",
);
const workosApiKey = configuredEnvironment("WORKOS_API_KEY");
const workosClientId = configuredEnvironment("WORKOS_CLIENT_ID");
const workosWebhookSecret = configuredEnvironment("WORKOS_WEBHOOK_SECRET");
const stripeSecretKey = configuredEnvironment("STRIPE_SECRET_KEY");
const stripeWebhookSecret = configuredEnvironment("STRIPE_WEBHOOK_SECRET");
const evidenceBucket = configuredEnvironment("EVIDENCE_BUCKET");
const evidenceRegion = configuredEnvironment("EVIDENCE_AWS_REGION");
const evidenceAccountId = configuredEnvironment("EVIDENCE_AWS_ACCOUNT_ID");
const esignWebhookSecret = configuredEnvironment("ESIGN_WEBHOOK_SECRET");
const esignApiBaseUrl = configuredEnvironment("ESIGN_API_BASE_URL");
const esignApiKey = configuredEnvironment("ESIGN_API_KEY");
const esignSigningOrigins = configuredEnvironment("ESIGN_SIGNING_ORIGINS")
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const provisioningWebhookSecret = configuredEnvironment(
  "PROVISIONING_WEBHOOK_SECRET",
);
const marketplaceWebhookSecret = configuredEnvironment(
  "MARKETPLACE_WEBHOOK_SECRET",
);
const migrationSourceBaseUrl = configuredEnvironment(
  "MIGRATION_SOURCE_BASE_URL",
);
const migrationSourceToken = configuredEnvironment("MIGRATION_SOURCE_TOKEN");
const migrationWindowId = configuredEnvironment("MIGRATION_SOURCE_WINDOW_ID");
const migrationAuthorizedActorId = configuredEnvironment(
  "MIGRATION_SOURCE_AUTHORIZED_ACTOR_ID",
);
const migrationAccessEvidenceHash = configuredEnvironment(
  "MIGRATION_SOURCE_ACCESS_EVIDENCE_HASH",
);
const externalGates = serviceDatabase
  ? new DatabaseExternalGateService(serviceDatabase)
  : undefined;
const externalGateActivationTests = createExternalGateActivationSimulator({
  enabled: process.env.CLOCKWORK_ENABLE_SIMULATORS === "true",
  runtimeEnvironment: process.env.NODE_ENV,
});
const externalGateGuard = serviceDatabase
  ? new PersistedExternalGateGuard(serviceDatabase)
  : undefined;
const migrationSource =
  externalGateGuard &&
  migrationSourceBaseUrl &&
  migrationSourceToken &&
  migrationWindowId &&
  migrationAuthorizedActorId &&
  migrationAccessEvidenceHash
    ? new GateCheckedProductionMigrationSource(
        new HttpMigrationSnapshotSource({
          transport: new FetchJsonProviderTransport({
            baseUrl: migrationSourceBaseUrl,
            bearerToken: migrationSourceToken,
            provider: "existing-customer-migration",
            allowInsecureLocalhost: process.env.NODE_ENV !== "production",
          }),
          windowId: migrationWindowId,
          authorizedActorId: migrationAuthorizedActorId,
          accessEvidenceHash: migrationAccessEvidenceHash,
          allowExecute:
            process.env.MIGRATION_SOURCE_EXECUTION_ENABLED === "true",
          ...(configuredEnvironment("MIGRATION_SOURCE_MAX_BYTES")
            ? {
                maxBytes: Number(
                  configuredEnvironment("MIGRATION_SOURCE_MAX_BYTES"),
                ),
              }
            : {}),
          ...(configuredEnvironment("MIGRATION_SOURCE_MAX_RECORDS")
            ? {
                maxRecords: Number(
                  configuredEnvironment("MIGRATION_SOURCE_MAX_RECORDS"),
                ),
              }
            : {}),
        }),
        externalGateGuard,
      )
    : new FailClosedProductionMigrationSource();
const unavailableProductionStore: IdempotencyStore = {
  claim: () =>
    Promise.reject(new Error("Durable idempotency database is not configured")),
  complete: () =>
    Promise.reject(new Error("Durable idempotency database is not configured")),
};
const idempotencyStore = serviceDatabase
  ? new DatabaseIdempotencyStore(serviceDatabase)
  : process.env.NODE_ENV === "production"
    ? unavailableProductionStore
    : undefined;
const workosWebhook =
  serviceDatabase && externalGateGuard && workosWebhookSecret && workosApiKey
    ? {
        verifier: new GateCheckedWebhookVerifier(
          new WorkosWebhookVerifier(workosWebhookSecret, workosApiKey),
          externalGateGuard,
          ["EXT-ACC-01", "EXT-DOMAIN-01"],
        ),
        deduplicator: new DatabaseWebhookDeduplicator(serviceDatabase),
        roleSink: new DatabaseRoleSynchronizationSink(serviceDatabase),
      }
    : undefined;
const lifecycleAuthorizationScopes = serviceDatabase
  ? new DatabaseLifecycleAuthorizationScopeResolver(serviceDatabase)
  : undefined;
const coreService =
  runtimeDatabase && serviceDatabase && authorizationSecret
    ? new DatabaseCoreFinanceService({
        database: runtimeDatabase,
        pricingDatabase: serviceDatabase,
        authorizationSecret,
      })
    : undefined;
const webhookDeduplicator = serviceDatabase
  ? new DatabaseWebhookDeduplicator(serviceDatabase)
  : undefined;
const stripeWebhook =
  serviceDatabase &&
  webhookDeduplicator &&
  externalGateGuard &&
  stripeSecretKey &&
  stripeWebhookSecret
    ? {
        verifier: new GateCheckedWebhookVerifier(
          new NormalizedStripeFinancialWebhookVerifier(
            new StripeFinancialWebhookVerifier(stripeWebhookSecret, {
              apiKey: stripeSecretKey,
            }),
          ),
          externalGateGuard,
          ["EXT-ACC-01"],
        ),
        deduplicator: webhookDeduplicator,
        apply: (event: unknown) =>
          new ProductionStripeWebhookProjection(serviceDatabase).apply(event),
      }
    : undefined;
const paymentSessions =
  runtimeDatabase && authorizationSecret && stripeSecretKey && externalGateGuard
    ? new ProductionCustomerPaymentSessionService(
        runtimeDatabase,
        authorizationSecret,
        new StripeInvoicePaymentSessionGateway({
          apiKey: stripeSecretKey,
        }),
        externalGateGuard,
      )
    : undefined;
const artifactReader =
  evidenceBucket && evidenceRegion && evidenceAccountId
    ? new S3ImmutableArtifactReader({
        bucket: evidenceBucket,
        region: evidenceRegion,
        expectedBucketOwner: evidenceAccountId,
      })
    : undefined;
const artifacts =
  runtimeDatabase &&
  serviceDatabase &&
  authorizationSecret &&
  artifactReader &&
  externalGateGuard
    ? new ProductionImmutableArtifactService(
        runtimeDatabase,
        serviceDatabase,
        authorizationSecret,
        artifactReader,
        externalGateGuard,
      )
    : undefined;
const signingSessions =
  serviceDatabase &&
  artifactReader &&
  externalGateGuard &&
  esignApiBaseUrl &&
  esignApiKey &&
  esignSigningOrigins?.length
    ? new ProductionEsignSigningSessionService(
        serviceDatabase,
        artifactReader,
        new HttpEsignSigningClient({
          baseUrl: esignApiBaseUrl,
          apiKey: esignApiKey,
          signingOrigins: esignSigningOrigins,
        }),
        externalGateGuard,
      )
    : undefined;
const activeAgreementTemplates =
  runtimeDatabase && authorizationSecret && externalGateGuard
    ? new ProductionActiveAgreementTemplateService(
        runtimeDatabase,
        authorizationSecret,
        externalGateGuard,
      )
    : undefined;
const policies = lifecyclePolicies();
const lifecycleService =
  runtimeDatabase && serviceDatabase && authorizationSecret && policies
    ? new TransactionalLifecycleService(
        new DatabaseLifecycleCommandRepository({
          database: runtimeDatabase,
          serviceDatabase,
          authorizationSecret,
          policies,
          migrationSource,
        }),
      )
    : undefined;
const registrationBootstrap =
  workosApiKey && workosClientId && externalGateGuard
    ? new GateCheckedRegistrationBootstrap(
        new WorkosRegistrationBootstrapVerifier(
          new WorkosAuthorizationCodeExchange(workosApiKey, workosClientId),
        ),
        externalGateGuard,
      )
    : undefined;
const partnerDomainOwnership = externalGateGuard
  ? new GateCheckedDomainOwnershipVerifier(
      new DnsTxtDomainOwnershipVerifier(),
      externalGateGuard,
    )
  : undefined;
const trustedOriginResolver =
  serviceDatabase && externalGateGuard
    ? new ProductionVerifiedPartnerOriginResolver(
        serviceDatabase,
        externalGateGuard,
      )
    : undefined;
const esignWebhook =
  serviceDatabase &&
  webhookDeduplicator &&
  esignWebhookSecret &&
  externalGateGuard
    ? {
        verifier: new GateCheckedWebhookVerifier(
          new EsignWebhookVerifier(
            esignWebhookSecret,
            new DatabaseEsignEnvelopeLookup(serviceDatabase),
          ),
          externalGateGuard,
          ["EXT-ACC-01", "EXT-PROVIDER-01", "EXT-DOMAIN-01"],
        ),
        deduplicator: webhookDeduplicator,
      }
    : undefined;
const provisioningWebhook =
  serviceDatabase &&
  webhookDeduplicator &&
  provisioningWebhookSecret &&
  externalGateGuard
    ? {
        verifier: new GateCheckedWebhookVerifier(
          new ProvisioningWebhookVerifier(
            provisioningWebhookSecret,
            new DatabaseProvisioningExpectationLookup(serviceDatabase),
          ),
          externalGateGuard,
          ["EXT-ACC-01", "EXT-PROVISION-01"],
        ),
        deduplicator: webhookDeduplicator,
      }
    : undefined;
const marketplaceWebhook =
  serviceDatabase &&
  webhookDeduplicator &&
  marketplaceWebhookSecret &&
  externalGateGuard
    ? {
        verifier: new GateCheckedWebhookVerifier(
          new MarketplaceWebhookVerifier(
            marketplaceWebhookSecret,
            new DatabaseMarketplaceWebhookBindingStore(
              new DatabaseProviderResourceBindingStore(serviceDatabase),
            ),
          ),
          externalGateGuard,
          ["EXT-ACC-01", "EXT-MARKETPLACE-01"],
        ),
        deduplicator: webhookDeduplicator,
      }
    : undefined;
const api = createApiApp({
  sessionResolver: new WorkosNextSessionResolver(),
  ...(trustedOriginResolver ? { trustedOriginResolver } : {}),
  ...(idempotencyStore ? { idempotencyStore } : {}),
  ...(coreService
    ? {
        core: {
          service: coreService,
          mode: "database" as const,
          ...(stripeWebhook ? { stripeWebhook } : {}),
          ...(paymentSessions ? { paymentSessions } : {}),
          ...(artifacts ? { artifacts } : {}),
        },
      }
    : {}),
  ...(lifecycleAuthorizationScopes ||
  lifecycleService ||
  registrationBootstrap ||
  partnerDomainOwnership ||
  activeAgreementTemplates ||
  signingSessions ||
  esignWebhook ||
  provisioningWebhook ||
  marketplaceWebhook
    ? {
        lifecycle: {
          ...(lifecycleAuthorizationScopes
            ? { authorizationScopes: lifecycleAuthorizationScopes }
            : {}),
          ...(lifecycleService ? { service: lifecycleService } : {}),
          ...(registrationBootstrap ? { registrationBootstrap } : {}),
          ...(partnerDomainOwnership ? { partnerDomainOwnership } : {}),
          ...(activeAgreementTemplates ? { activeAgreementTemplates } : {}),
          ...(signingSessions ? { signingSessions } : {}),
          ...(esignWebhook ? { esignWebhook } : {}),
          ...(provisioningWebhook ? { provisioningWebhook } : {}),
          ...(marketplaceWebhook ? { marketplaceWebhook } : {}),
        },
      }
    : {}),
  ...(externalGates || externalGateActivationTests || workosWebhook
    ? {
        system: {
          ...(externalGates ? { externalGates } : {}),
          ...(externalGateActivationTests
            ? { externalGateActivationTests }
            : {}),
          ...(workosWebhook ? { workosWebhook } : {}),
        },
      }
    : {}),
});

async function handle(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  return api.fetch(new Request(url, request));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
