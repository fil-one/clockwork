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
import { uuidV7 } from "@clockwork/contracts";
import {
  applyResponseHeaders,
  authkit,
  getTokenClaims,
  isAuthkitRequestHeader,
  partitionAuthkitHeaders,
  type UserInfo,
} from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
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

import { releaseProofConfiguration } from "@/src/auth/release-proof";
import {
  WorkosNextSessionResolver,
  workosAuthenticationConfigured,
} from "@/src/auth/session";
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
const apiRequestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
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

function apiAuthenticationProblem(input: {
  readonly requestId: string;
  readonly status: 401 | 403 | 503;
  readonly code:
    | "AUTHENTICATION_REQUIRED"
    | "AUTHENTICATION_NOT_CONFIGURED"
    | "AUTHKIT_UNAVAILABLE"
    | "AUTHKIT_IDENTITY_MISMATCH"
    | "AUTHKIT_HEADER_REJECTED"
    | "ORGANIZATION_SELECTION_REQUIRED";
  readonly title: string;
  readonly detail: string;
}): NextResponse {
  return NextResponse.json(
    {
      type: `https://clockwork.test/problems/${input.code
        .toLowerCase()
        .replaceAll("_", "-")}`,
      title: input.title,
      status: input.status,
      detail: input.detail,
      code: input.code,
      requestId: input.requestId,
      retryable: input.status === 503,
    },
    {
      status: input.status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-request-id": input.requestId,
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function withAuthkitResponseHeaders(
  response: Response,
  headers: Headers,
): NextResponse {
  return applyResponseHeaders(
    new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    headers,
  );
}

function isAnonymousRegistration(request: Request, pathname: string): boolean {
  return (
    request.method === "POST" && pathname === "/v1/lifecycle/registrations"
  );
}

function rewriteApiRequest(request: Request, url: URL): Request {
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: new Headers(request.headers),
    signal: request.signal,
  };
  // Passing a Request object as `RequestInit` is not a supported raw-body
  // forwarding mechanism in the Netlify/Node fetch implementation: its body
  // is silently omitted. Move the untouched stream explicitly and let Hono be
  // the first component that interprets those bytes.
  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId =
    suppliedRequestId && apiRequestIdPattern.test(suppliedRequestId)
      ? suppliedRequestId
      : uuidV7();
  for (const name of request.headers.keys())
    if (isAuthkitRequestHeader(name))
      return apiAuthenticationProblem({
        requestId,
        status: 403,
        code: "AUTHKIT_HEADER_REJECTED",
        title: "Authentication header rejected",
        detail: "Internal AuthKit headers cannot be supplied by an API caller.",
      });

  const isWebhook = url.pathname.startsWith("/v1/webhooks/");
  const isRegistration = isAnonymousRegistration(request, url.pathname);
  const releaseProof = releaseProofConfiguration();
  const workosConfigured = workosAuthenticationConfigured();
  if (
    !isWebhook &&
    !isRegistration &&
    !releaseProof &&
    !workosConfigured &&
    process.env.NODE_ENV === "production"
  )
    return apiAuthenticationProblem({
      requestId,
      status: 503,
      code: "AUTHENTICATION_NOT_CONFIGURED",
      title: "Authentication is not configured",
      detail: "This API cannot accept authenticated requests right now.",
    });
  let verifiedWorkosSession: UserInfo | undefined;
  let authkitResponseHeaders: Headers | undefined;
  if (!isWebhook && !isRegistration && !releaseProof && workosConfigured) {
    // AuthKit verifies and, when necessary, refreshes the sealed WorkOS cookie
    // on a header-only request. The original request body is never cloned,
    // buffered or consumed at this boundary; Hono remains its only reader.
    const authHeaders = new Headers(request.headers);
    authHeaders.set("x-request-id", requestId);
    const authRequest = new NextRequest(request.url, {
      method: request.method,
      headers: authHeaders,
    });
    let verified: Awaited<ReturnType<typeof authkit>>;
    try {
      verified = await authkit(authRequest, {
        redirectUri:
          process.env.WORKOS_REDIRECT_URI ??
          "http://localhost:3000/auth/callback",
      });
    } catch {
      // A returned empty/expired session is an authentication failure below.
      // An exception means AuthKit could not make a trustworthy decision
      // (configuration, key discovery, or refresh infrastructure), so expose a
      // bounded retryable problem instead of leaking a generic framework 500.
      return apiAuthenticationProblem({
        requestId,
        status: 503,
        code: "AUTHKIT_UNAVAILABLE",
        title: "Authentication is temporarily unavailable",
        detail: "The authentication service could not verify this request.",
      });
    }
    authkitResponseHeaders = partitionAuthkitHeaders(
      authRequest,
      verified.headers,
    ).responseHeaders;
    if (!verified.session.user)
      return withAuthkitResponseHeaders(
        apiAuthenticationProblem({
          requestId,
          status: 401,
          code: "AUTHENTICATION_REQUIRED",
          title: "Authentication required",
          detail: "A valid WorkOS session is required for this API route.",
        }),
        authkitResponseHeaders,
      );
    if (!verified.session.organizationId)
      return withAuthkitResponseHeaders(
        apiAuthenticationProblem({
          requestId,
          status: 403,
          code: "ORGANIZATION_SELECTION_REQUIRED",
          title: "Organization selection required",
          detail: "Select a WorkOS organization before using this API route.",
        }),
        authkitResponseHeaders,
      );
    const tokenClaims = await getTokenClaims<{ sub?: unknown }>(
      verified.session.accessToken,
    ).catch(() => undefined);
    if (
      typeof tokenClaims?.sub !== "string" ||
      tokenClaims.sub !== verified.session.user.id
    )
      return withAuthkitResponseHeaders(
        apiAuthenticationProblem({
          requestId,
          status: 401,
          code: "AUTHKIT_IDENTITY_MISMATCH",
          title: "Authenticated identity is invalid",
          detail:
            "The WorkOS session user does not match the verified access token.",
        }),
        authkitResponseHeaders,
      );
    verifiedWorkosSession = verified.session;
  }
  const parent = parseTraceparent(request.headers.get("traceparent"));
  const route = isWebhook
    ? "/v1/webhooks/{provider}"
    : url.pathname.startsWith("/v1/")
      ? "/v1/{lane}/{resource}"
      : "/{resource}";
  const response = await runtimeBoundaryInstrumentation.api({
    name: "api.request",
    correlation: { requestId },
    attributes: {
      "clockwork.operation": "api.request",
      "http.request.method": request.method,
      "http.route": route,
    },
    ...(parent ? { parent } : {}),
    onResult: denialSpanAttributes,
    operation: () => {
      const apiRequest = rewriteApiRequest(request, url);
      apiRequest.headers.set("x-request-id", requestId);
      if (verifiedWorkosSession)
        sessionResolver.bindVerifiedSession(apiRequest, verifiedWorkosSession);
      const dispatch = () => Promise.resolve(api.fetch(apiRequest));
      return isWebhook
        ? runtimeBoundaryInstrumentation.webhook({
            name: "webhook.request",
            correlation: { requestId },
            attributes: {
              "clockwork.operation": "webhook.request",
              "http.request.method": request.method,
              "http.route": "/v1/webhooks/{provider}",
            },
            onResult: denialSpanAttributes,
            operation: dispatch,
          })
        : dispatch();
    },
  });
  const finalResponse = authkitResponseHeaders
    ? withAuthkitResponseHeaders(response, authkitResponseHeaders)
    : response;
  if (!authkitResponseHeaders)
    finalResponse.headers.set("cache-control", "private, no-store");
  return finalResponse;
}
