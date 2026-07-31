import type {
  LifecycleOperationContext,
  LifecycleRouteResult,
  LifecycleRouteService,
} from "./types";

export type LifecycleCommand =
  | "register"
  | "invite_member"
  | "switch_account"
  | "verify_partner_domain"
  | "update_procurement"
  | "publish_agreement_template"
  | "upload_customer_paper"
  | "execute_click_through"
  | "create_signature_envelope"
  | "ingest_signature_event"
  | "ingest_provisioning_event"
  | "ingest_marketplace_event"
  | "create_poc"
  | "decide_poc"
  | "convert_poc"
  | "recover_provisioning"
  | "accept_pass_through_terms"
  | "record_inbound_notice"
  | "renewal_command_center"
  | "request_renewal"
  | "decline_renewal"
  | "request_termination"
  | "decide_termination"
  | "create_novation"
  | "open_exception"
  | "decide_exception"
  | "list_support_signals"
  | "start_migration"
  | "decide_migration_match";

/**
 * Production repository boundary. Implementations must execute the command in
 * one authorized database transaction, run the matching domain state machine,
 * and append audit/outbox records atomically with the state change. Reads and
 * provider callbacks use service authorization and durable webhook claims.
 */
export interface LifecycleCommandRepository {
  executeInTransaction(input: {
    command: LifecycleCommand;
    payload: unknown;
    context: LifecycleOperationContext;
  }): Promise<LifecycleRouteResult>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("LIFECYCLE_COMMAND_PAYLOAD_INVALID");
  return value as Record<string, unknown>;
}

/** Concrete application service shared by HTTP, assisted, and webhook entry points. */
export class TransactionalLifecycleService implements LifecycleRouteService {
  public constructor(private readonly repository: LifecycleCommandRepository) {}

  private execute(
    command: LifecycleCommand,
    payload: unknown,
    context: LifecycleOperationContext,
    options: { mutation?: boolean; provider?: boolean } = {},
  ): Promise<LifecycleRouteResult> {
    if (options.mutation !== false && !context.idempotencyKey)
      throw new Error("LIFECYCLE_IDEMPOTENCY_KEY_REQUIRED");
    if (options.provider && context.actor.kind !== "provider")
      throw new Error("PROVIDER_ACTOR_REQUIRED");
    return this.repository.executeInTransaction({ command, payload, context });
  }

  public register(input: unknown, context: LifecycleOperationContext) {
    const payload = record(input);
    if (
      typeof payload.workosUserId !== "string" ||
      typeof payload.domainVerifiedAt !== "string"
    )
      throw new Error("TRUSTED_REGISTRATION_EVIDENCE_REQUIRED");
    return this.execute("register", payload, context);
  }

  public inviteMember(input: unknown, context: LifecycleOperationContext) {
    return this.execute("invite_member", input, context);
  }

  public switchAccount(input: unknown, context: LifecycleOperationContext) {
    return this.execute("switch_account", input, context);
  }

  public verifyPartnerDomain(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("verify_partner_domain", input, context);
  }

  public updateProcurement(input: unknown, context: LifecycleOperationContext) {
    return this.execute("update_procurement", input, context);
  }

  public publishAgreementTemplate(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("publish_agreement_template", input, context);
  }

  public uploadCustomerPaper(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("upload_customer_paper", input, context);
  }

  public executeClickThrough(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    const payload = record(input);
    if (
      "cumulativeAccountValueMinor" in payload ||
      "clickThroughThresholdMinor" in payload
    )
      throw new Error("CONTRACT_VALUE_MUST_BE_SERVER_DERIVED");
    return this.execute("execute_click_through", payload, context);
  }

  public createSignatureEnvelope(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("create_signature_envelope", input, context);
  }

  public ingestSignatureEvent(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("ingest_signature_event", input, context, {
      provider: true,
    });
  }

  public ingestProvisioningEvent(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("ingest_provisioning_event", input, context, {
      provider: true,
    });
  }

  public ingestMarketplaceEvent(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("ingest_marketplace_event", input, context, {
      provider: true,
    });
  }

  public createPoc(input: unknown, context: LifecycleOperationContext) {
    return this.execute("create_poc", input, context);
  }

  public decidePoc(input: unknown, context: LifecycleOperationContext) {
    return this.execute("decide_poc", input, context);
  }

  public convertPoc(input: unknown, context: LifecycleOperationContext) {
    const payload = record(input);
    if (
      "allSuccessTestsPassed" in payload ||
      "preserveTenant" in payload ||
      "qualificationApproved" in payload
    )
      throw new Error("POC_CONVERSION_STATE_MUST_BE_SERVER_DERIVED");
    return this.execute("convert_poc", payload, context);
  }

  public recoverProvisioning(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("recover_provisioning", input, context);
  }

  public acceptPassThroughTerms(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("accept_pass_through_terms", input, context);
  }

  public recordInboundNotice(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("record_inbound_notice", input, context);
  }

  public renewalCommandCenter(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("renewal_command_center", input, context, {
      mutation: false,
    });
  }

  public requestRenewal(input: unknown, context: LifecycleOperationContext) {
    return this.execute("request_renewal", input, context);
  }

  public declineRenewal(input: unknown, context: LifecycleOperationContext) {
    return this.execute("decline_renewal", input, context);
  }

  public requestTermination(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("request_termination", input, context);
  }

  public decideTermination(input: unknown, context: LifecycleOperationContext) {
    return this.execute("decide_termination", input, context);
  }

  public createNovation(input: unknown, context: LifecycleOperationContext) {
    return this.execute("create_novation", input, context);
  }

  public openException(input: unknown, context: LifecycleOperationContext) {
    return this.execute("open_exception", input, context);
  }

  public decideException(input: unknown, context: LifecycleOperationContext) {
    return this.execute("decide_exception", input, context);
  }

  public listSupportSignals(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("list_support_signals", input, context, {
      mutation: false,
    });
  }

  public startMigration(input: unknown, context: LifecycleOperationContext) {
    const payload = record(input);
    if ("featureFlag" in payload || "approvals" in payload)
      throw new Error("MIGRATION_AUTHORIZATION_MUST_BE_SERVER_DERIVED");
    return this.execute("start_migration", payload, context);
  }

  public decideMigrationMatch(
    input: unknown,
    context: LifecycleOperationContext,
  ) {
    return this.execute("decide_migration_match", input, context);
  }
}
