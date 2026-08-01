import type { Actor, WebhookVerifier } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import type { WebhookDeduplicator } from "../../webhooks";

export interface LifecycleOperationContext {
  requestId: string;
  actor: Actor;
  idempotencyKey: string | null;
  ip: string | null;
  userAgent: string | null;
  occurredAt: string;
  authorization: AuthorizationContext | null;
}

export interface RegistrationBootstrapVerifier {
  verify(input: {
    token: string;
    email: string;
    businessDomain: string;
    requestId: string;
  }): Promise<{
    actor: Actor;
    workosUserId: string;
    domainVerifiedAt: string;
  }>;
}

export interface PartnerDomainOwnershipVerifier {
  verify(input: {
    domain: string;
    verificationToken: string;
    requestId: string;
  }): Promise<{ verifiedAt: string; evidenceReference: string }>;
}

export type LifecycleExceptionQueue =
  | "pricing"
  | "legal"
  | "credit_collections"
  | "restricted_parties"
  | "disputes"
  | "deal_registration_disputes"
  | "poc_qualification";

/** Looks up authorization facts from commerce-owned records, never request input. */
export interface LifecycleAuthorizationScopeResolver {
  resolvePocAccount(input: {
    pocId: string;
    requestId: string;
  }): Promise<{ accountId: string }>;
  resolveExceptionScope(input: {
    caseId: string;
    requestId: string;
  }): Promise<{ accountId: string | null; queue: LifecycleExceptionQueue }>;
  resolveOrderScope(input: { orderId: string; requestId: string }): Promise<{
    accountId: string;
    partnerAccountId: string | null;
    authorizationAccountId: string;
  }>;
}

export interface LifecycleRouteResult {
  id: string;
  status: string;
  eventType?: string | undefined;
  signingUrl?: string | undefined;
  [key: string]: unknown;
}

export interface ActiveAgreementTemplateService {
  getActive(input: {
    type: string;
    jurisdiction: string;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<{
    id: string;
    type: string;
    semanticVersion: string;
    jurisdiction: string;
    effectiveOn: string;
    canonicalDocumentId: string;
    exactText: string;
    exactTextHash: string;
    executionMode: "click_through" | "counter_signed";
  }>;
}

export interface LifecycleRouteService {
  register(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  inviteMember(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  switchAccount(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  verifyPartnerDomain(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  updateProcurement(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  publishAgreementTemplate(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  uploadCustomerPaper(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  executeClickThrough(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  createSignatureEnvelope(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  ingestSignatureEvent(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  ingestProvisioningEvent(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  ingestMarketplaceEvent(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  createPoc(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  decidePoc(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  convertPoc(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  recoverProvisioning(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  acceptPassThroughTerms(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  recordInboundNotice(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  renewalCommandCenter(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  requestRenewal(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  declineRenewal(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  requestTermination(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  decideTermination(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  createNovation(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  openException(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  decideException(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  listSupportSignals(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  startMigration(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
  decideMigrationMatch(
    input: unknown,
    context: LifecycleOperationContext,
  ): Promise<LifecycleRouteResult>;
}

export interface LifecycleRouteDependencies {
  service?: LifecycleRouteService;
  authorizationScopes?: LifecycleAuthorizationScopeResolver;
  registrationBootstrap?: RegistrationBootstrapVerifier;
  partnerDomainOwnership?: PartnerDomainOwnershipVerifier;
  activeAgreementTemplates?: ActiveAgreementTemplateService;
  signingSessions?: {
    create(input: {
      envelope: LifecycleRouteResult;
      request: {
        accountId: string;
        agreementId: string;
        documentId: string;
        signerEmail: string;
        mode: "redirect" | "embedded";
        returnUrl: string;
      };
      context: LifecycleOperationContext;
    }): Promise<LifecycleRouteResult & { signingUrl: string }>;
  };
  esignWebhook?: {
    verifier: WebhookVerifier<unknown>;
    deduplicator: WebhookDeduplicator;
  };
  provisioningWebhook?: {
    verifier: WebhookVerifier<unknown>;
    deduplicator: WebhookDeduplicator;
  };
  marketplaceWebhook?: {
    verifier: WebhookVerifier<unknown>;
    deduplicator: WebhookDeduplicator;
  };
}
