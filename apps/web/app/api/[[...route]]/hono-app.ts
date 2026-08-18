import {
  createApiApp,
  createExternalGateActivationSimulator,
  DatabaseCoreFinanceService,
  DatabaseIdempotencyStore,
  TransactionalLifecycleService,
  type IdempotencyStore,
} from "@clockwork/api";
import {
  configureDatabaseTransactionInstrumentation,
  DatabaseEsignEnvelopeLookup,
  DatabaseExceptionRosterAdminService,
  DatabaseExternalGateService,
  DatabaseLifecycleCommandRepository,
  DatabasePersistedWorkflowExceptionRouting,
  DatabaseLifecycleAuthorizationScopeResolver,
  DatabaseNotificationDeliveryRepository,
  DatabaseNotificationPreferenceRepository,
  DatabaseMarketplaceWebhookBindingStore,
  DatabaseProviderResourceBindingStore,
  DatabaseProvisioningExpectationLookup,
  DatabaseRoleSynchronizationSink,
  DatabaseSupportWebhookBindingStore,
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
  ProviderScopedWebhookVerifier,
  ProvisioningWebhookVerifier,
  S3ImmutableArtifactReader,
  SupportWebhookVerifier,
  StripeFinancialWebhookVerifier,
  StripeInvoicePaymentSessionGateway,
  WorkosAuthorizationCodeExchange,
  WorkosRegistrationBootstrapVerifier,
  WorkosWebhookVerifier,
} from "@clockwork/integrations";
import {
  denialSpanAttributes,
  parseTraceparent,
} from "@clockwork/integrations/telemetry";
import { TriggerExternalGateActivationTaskSubmitter } from "@clockwork/workflows/system";

import { withRawApiAuthentication } from "@/src/auth/raw-api-boundary";
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
import { composedTaxProvider } from "@/src/providers/tax";
import {
  databaseTransactionTelemetry,
  instrumentProviderTransport,
  runtimeBoundaryInstrumentation,
} from "@/src/telemetry/runtime";

configureDatabaseTransactionInstrumentation(databaseTransactionTelemetry);

function configuredEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function lifecyclePolicies(): DatabaseLifecyclePolicies | undefined {
  const threshold = process.env.CLICK_THROUGH_THRESHOLD_MINOR;
  if (!threshold) return undefined;
  return {
    clickThroughThresholdMinor: threshold,
    migrationFeatureEnabled: process.env.MIGRATION_FEATURE_ENABLED === "true",
    automatedTeardownEnabled: process.env.AUTOMATED_TEARDOWN_ENABLED === "true",
    exceptionQueues: [],
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
// Every marketplace and every support provider signs with its own secret. A
// single shared key would let any one integration sign for another provider's
// resources, so a provider without its own configured secret is not wired up at
// all and its deliveries are denied rather than falling back to a shared key.
const marketplaceWebhookSecrets = new Map(
  (["aws", "azure", "google"] as const).flatMap((marketplace) => {
    const secret = configuredEnvironment(
      `MARKETPLACE_WEBHOOK_SECRET_${marketplace.toUpperCase()}`,
    );
    return secret ? [[marketplace, secret] as const] : [];
  }),
);
const supportWebhookSecrets = new Map(
  (configuredEnvironment("SUPPORT_PROVIDERS")?.split(",") ?? []).flatMap(
    (entry) => {
      const provider = entry.trim();
      if (!provider) return [];
      const secret = configuredEnvironment(
        `SUPPORT_WEBHOOK_SECRET_${provider.toUpperCase().replaceAll("-", "_")}`,
      );
      return secret ? [[provider, secret] as const] : [];
    },
  ),
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
const externalGateAdministration = serviceDatabase
  ? {
      exceptionRoster: new DatabaseExceptionRosterAdminService(serviceDatabase),
      ...(configuredEnvironment("TRIGGER_SECRET_KEY") &&
      configuredEnvironment("TRIGGER_PROJECT_REF")
        ? {
            activationTasks: new TriggerExternalGateActivationTaskSubmitter(),
          }
        : {}),
    }
  : undefined;
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
          transport: instrumentProviderTransport(
            "existing-customer-migration",
            new FetchJsonProviderTransport({
              baseUrl: migrationSourceBaseUrl,
              bearerToken: migrationSourceToken,
              provider: "existing-customer-migration",
              allowInsecureLocalhost: process.env.NODE_ENV !== "production",
            }),
          ),
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
// §18 lists `/notifications`. The read runs on the tenant pool so
// `notification_delivery_read` is the account boundary.
const notificationDeliveries =
  runtimeDatabase && authorizationSecret
    ? new DatabaseNotificationDeliveryRepository({
        database: runtimeDatabase,
        authorizationSecret,
      })
    : undefined;
const notificationPreferences =
  runtimeDatabase && authorizationSecret
    ? new DatabaseNotificationPreferenceRepository({
        database: runtimeDatabase,
        authorizationSecret,
      })
    : undefined;
// The tax gate belongs on the commands that can write a `tax_minor`, not on
// the composition of the lane that contains them. An absent EXT-TAX-01 provider
// once meant every invoice was written net (P0-61); making it a composition
// precondition instead meant every /v1/core/commands/* write on every surface
// answered 500 "Core-finance route dependencies are not configured" -- quote
// creation included, which never calls the tax port. `composedTaxProvider`
// keeps the refusal and puts it back where the risk is: `orders:create` (quote
// acceptance) and `invoices:create` refuse, because those are the only two
// commands that ask the port for a determination.
const taxProvider = composedTaxProvider();
const coreService =
  runtimeDatabase && serviceDatabase && authorizationSecret
    ? new DatabaseCoreFinanceService({
        database: runtimeDatabase,
        pricingDatabase: serviceDatabase,
        authorizationSecret,
        tax: taxProvider,
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
          exceptionRouting: new DatabasePersistedWorkflowExceptionRouting(
            serviceDatabase,
          ),
          migrationSource,
          // The same composed port also answers for the tax identifiers a
          // registration carries. Until this line existed, the lifecycle
          // repository's `tax` option had no production injection at all, so
          // every registration carrying a tax id failed even with EXT-TAX-01
          // fully configured — and `core_account_tax_identifiers` had no
          // reachable production writer. Unlike `orders:create` and
          // `invoices:create`, an unconfigured provider does not refuse here:
          // a registration tax id is reference data, not a `tax_minor`, so the
          // repository records it as unverified and lets the registration
          // proceed (see `verifyRegistrationTaxIds`).
          tax: taxProvider,
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
  marketplaceWebhookSecrets.size > 0 &&
  externalGateGuard
    ? {
        verifier: new GateCheckedWebhookVerifier(
          new ProviderScopedWebhookVerifier(
            "marketplace",
            new Map(
              [...marketplaceWebhookSecrets].map(([marketplace, secret]) => [
                marketplace,
                new MarketplaceWebhookVerifier(
                  secret,
                  new DatabaseMarketplaceWebhookBindingStore(
                    new DatabaseProviderResourceBindingStore(serviceDatabase),
                  ),
                ),
              ]),
            ),
          ),
          externalGateGuard,
          ["EXT-ACC-01", "EXT-MARKETPLACE-01"],
        ),
        deduplicator: webhookDeduplicator,
      }
    : undefined;
const supportWebhook =
  serviceDatabase &&
  webhookDeduplicator &&
  supportWebhookSecrets.size > 0 &&
  externalGateGuard
    ? {
        verifier: new GateCheckedWebhookVerifier(
          new ProviderScopedWebhookVerifier(
            "provider",
            new Map(
              [...supportWebhookSecrets].map(([provider, secret]) => [
                provider,
                new SupportWebhookVerifier(
                  provider,
                  secret,
                  new DatabaseSupportWebhookBindingStore(
                    new DatabaseProviderResourceBindingStore(serviceDatabase),
                  ),
                ),
              ]),
            ),
          ),
          externalGateGuard,
          ["EXT-ACC-01", "EXT-PROVIDER-01"],
        ),
        deduplicator: webhookDeduplicator,
      }
    : undefined;
const sessionResolver = new WorkosNextSessionResolver({
  requireBoundSession: true,
});
const api = createApiApp({
  sessionResolver,
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
  notificationDeliveries ||
  notificationPreferences ||
  lifecycleService ||
  registrationBootstrap ||
  partnerDomainOwnership ||
  activeAgreementTemplates ||
  signingSessions ||
  esignWebhook ||
  provisioningWebhook ||
  marketplaceWebhook ||
  supportWebhook
    ? {
        lifecycle: {
          ...(lifecycleAuthorizationScopes
            ? { authorizationScopes: lifecycleAuthorizationScopes }
            : {}),
          ...(lifecycleService ? { service: lifecycleService } : {}),
          ...(notificationDeliveries ? { notificationDeliveries } : {}),
          ...(notificationPreferences ? { notificationPreferences } : {}),
          ...(registrationBootstrap ? { registrationBootstrap } : {}),
          ...(partnerDomainOwnership ? { partnerDomainOwnership } : {}),
          ...(activeAgreementTemplates ? { activeAgreementTemplates } : {}),
          ...(signingSessions ? { signingSessions } : {}),
          ...(esignWebhook ? { esignWebhook } : {}),
          ...(provisioningWebhook ? { provisioningWebhook } : {}),
          ...(marketplaceWebhook ? { marketplaceWebhook } : {}),
          ...(supportWebhook ? { supportWebhook } : {}),
        },
      }
    : {}),
  ...(externalGates ||
  externalGateActivationTests ||
  externalGateAdministration ||
  workosWebhook
    ? {
        system: {
          ...(externalGates ? { externalGates } : {}),
          ...(externalGateActivationTests
            ? { externalGateActivationTests }
            : {}),
          ...(externalGateAdministration ? { externalGateAdministration } : {}),
          ...(workosWebhook ? { workosWebhook } : {}),
        },
      }
    : {}),
});

function isAnonymousRegistration(request: Request, pathname: string): boolean {
  return (
    request.method === "POST" && pathname === "/v1/lifecycle/registrations"
  );
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  const isWebhook = url.pathname.startsWith("/v1/webhooks/");
  const isRegistration = isAnonymousRegistration(request, url.pathname);
  return withRawApiAuthentication({
    request,
    targetUrl: url,
    sessionResolver,
    authenticationRequired: !isWebhook && !isRegistration,
    dispatch: (apiRequest, requestId) => {
      const parent = parseTraceparent(apiRequest.headers.get("traceparent"));
      const route = isWebhook
        ? "/v1/webhooks/{provider}"
        : url.pathname.startsWith("/v1/")
          ? "/v1/{lane}/{resource}"
          : "/{resource}";
      return runtimeBoundaryInstrumentation.api({
        name: "api.request",
        correlation: { requestId },
        attributes: {
          "clockwork.operation": "api.request",
          "http.request.method": apiRequest.method,
          "http.route": route,
        },
        ...(parent ? { parent } : {}),
        onResult: denialSpanAttributes,
        operation: () => {
          const dispatch = () => Promise.resolve(api.fetch(apiRequest));
          return isWebhook
            ? runtimeBoundaryInstrumentation.webhook({
                name: "webhook.request",
                correlation: { requestId },
                attributes: {
                  "clockwork.operation": "webhook.request",
                  "http.request.method": apiRequest.method,
                  "http.route": "/v1/webhooks/{provider}",
                },
                onResult: denialSpanAttributes,
                operation: dispatch,
              })
            : dispatch();
        },
      });
    },
  });
}
