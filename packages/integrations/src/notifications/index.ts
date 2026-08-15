import { createHash } from "node:crypto";

import type { IdempotencyKey, ProviderResult } from "@clockwork/contracts";

export type NotificationAudience =
  "customer" | "partner" | "end_client" | "internal";

export interface TenantBrandingPolicy {
  policyId: string;
  displayName: string;
  logoUrl?: string;
  primaryColor?: string;
  customDomain?: string;
  customDomainVerified: boolean;
  replyTo?: string;
}

export interface NotificationRecipient {
  email: string;
  audience: NotificationAudience;
  accountId: string;
}

export interface LifecycleNotification {
  template:
    | "organization-invitation"
    | "end-client-invitation"
    | "agreement-signature"
    | "provisioning-completed"
    | "provisioning-failed"
    | "renewal-reminder"
    | "notice-window"
    | "poc-milestone"
    | "offboarding-update"
    | "procurement-reminder";
  recipients: readonly NotificationRecipient[];
  data: Readonly<Record<string, unknown>>;
  communicationOwner: "fil_one" | "partner";
  brandingPolicy?: TenantBrandingPolicy;
  idempotencyKey: IdempotencyKey;
}

export interface NotificationDelivery {
  messageIds: readonly string[];
  deliveredRecipients: readonly string[];
  brand: "fil_one" | "partner" | "safe_default";
  fromDomain: string;
}

export interface LifecycleNotificationPort {
  send(
    input: LifecycleNotification,
  ): Promise<ProviderResult<NotificationDelivery>>;
}

export interface NotificationProviderClient {
  send(input: {
    template: string;
    recipient: string;
    data: Readonly<Record<string, unknown>>;
    brand: ResolvedBrand;
    idempotencyKey: string;
  }): Promise<{ messageId: string }>;
}

export interface ResolvedBrand {
  kind: "fil_one" | "partner" | "safe_default";
  displayName: string;
  fromDomain: string;
  replyTo?: string;
  logoUrl?: string;
  primaryColor?: string;
}

export class LifecycleNotificationAdapter implements LifecycleNotificationPort {
  public constructor(private readonly client: NotificationProviderClient) {}

  public async send(
    input: LifecycleNotification,
  ): Promise<ProviderResult<NotificationDelivery>> {
    const validation = validateNotification(input);
    if (validation) return validation;
    const brand = resolveBrand(input.brandingPolicy, input.communicationOwner);
    try {
      const responses = await Promise.all(
        input.recipients.map((recipient, index) =>
          this.client.send({
            template: input.template,
            recipient: recipient.email.toLowerCase(),
            data:
              recipient.audience === "end_client"
                ? projectEndClientData(input.template, input.data)
                : input.data,
            brand,
            idempotencyKey: `${input.idempotencyKey}:${index}`,
          }),
        ),
      );
      return {
        ok: true,
        value: {
          messageIds: responses.map((item) => item.messageId),
          deliveredRecipients: input.recipients.map((item) =>
            item.email.toLowerCase(),
          ),
          brand: brand.kind,
          fromDomain: brand.fromDomain,
        },
      };
    } catch (error) {
      return {
        ok: false,
        kind: "transient",
        code: "NOTIFICATION_PROVIDER_ERROR",
        message:
          error instanceof Error ? error.message : "Unknown notification error",
      };
    }
  }
}

interface FakeDeliveryRecord {
  template: string;
  recipient: NotificationRecipient;
  data: Readonly<Record<string, unknown>>;
  brand: ResolvedBrand;
  messageId: string;
}

export class FakeLifecycleNotificationAdapter implements LifecycleNotificationPort {
  private readonly keys = new Map<
    string,
    { fingerprint: string; delivery: NotificationDelivery }
  >();
  private nextFailure: "transient" | "permanent" | undefined;
  public readonly deliveries: FakeDeliveryRecord[] = [];

  public failNext(kind: "transient" | "permanent"): void {
    this.nextFailure = kind;
  }

  public send(
    input: LifecycleNotification,
  ): Promise<ProviderResult<NotificationDelivery>> {
    const validation = validateNotification(input);
    if (validation) return Promise.resolve(validation);
    if (this.nextFailure) {
      const kind = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.resolve({
        ok: false,
        kind,
        code: "NOTIFICATION_SIMULATED_FAILURE",
        message: "Simulated notification failure",
        ...(kind === "transient" ? { retryAfterMs: 1_000 } : {}),
      });
    }
    const fingerprint = hash(JSON.stringify(input));
    const existing = this.keys.get(input.idempotencyKey);
    if (existing && existing.fingerprint !== fingerprint)
      return Promise.resolve(
        permanent("IDEMPOTENCY_CONFLICT", "Notification key input changed"),
      );
    if (existing)
      return Promise.resolve({
        ok: true,
        value: existing.delivery,
        duplicate: true,
      });
    const brand = resolveBrand(input.brandingPolicy, input.communicationOwner);
    const records = input.recipients.map((recipient, index) => ({
      template: input.template,
      recipient,
      data:
        recipient.audience === "end_client"
          ? projectEndClientData(input.template, input.data)
          : input.data,
      brand,
      messageId: `msg_fake_${hash(`${input.idempotencyKey}:${index}`).slice(0, 20)}`,
    }));
    this.deliveries.push(...records);
    const delivery: NotificationDelivery = {
      messageIds: records.map((record) => record.messageId),
      deliveredRecipients: records.map((record) =>
        record.recipient.email.toLowerCase(),
      ),
      brand: brand.kind,
      fromDomain: brand.fromDomain,
    };
    this.keys.set(input.idempotencyKey, { fingerprint, delivery });
    return Promise.resolve({ ok: true, value: delivery });
  }
}

export function resolveBrand(
  policy: TenantBrandingPolicy | undefined,
  communicationOwner: LifecycleNotification["communicationOwner"] = "fil_one",
): ResolvedBrand {
  if (!policy)
    return communicationOwner === "partner"
      ? {
          kind: "safe_default",
          displayName: "Commerce Services",
          fromDomain: "notifications.filone.example",
        }
      : {
          kind: "fil_one",
          displayName: "Fil One",
          fromDomain: "notifications.filone.example",
        };
  if (
    policy.customDomainVerified &&
    policy.customDomain &&
    isDomain(policy.customDomain)
  )
    return {
      kind: "partner",
      displayName: policy.displayName,
      fromDomain: policy.customDomain.toLowerCase(),
      ...(policy.replyTo ? { replyTo: policy.replyTo } : {}),
      ...(policy.logoUrl ? { logoUrl: policy.logoUrl } : {}),
      ...(policy.primaryColor ? { primaryColor: policy.primaryColor } : {}),
    };
  return {
    kind: "safe_default",
    // Until domain ownership is verified, no partner-controlled display name,
    // reply-to, logo, color, or domain is trusted for delivery.
    displayName: "Commerce Services",
    fromDomain: "notifications.filone.example",
  };
}

/**
 * What the platform knows about one recipient at delivery time. The lifecycle
 * planner passes only `{template, recipients, data}` through `NotificationPort`,
 * so the brand a message is sent under has to be resolved from the address
 * itself rather than carried on the effect.
 */
export interface NotificationRecipientContext {
  accountId: string;
  audience: NotificationAudience;
  communicationOwner: LifecycleNotification["communicationOwner"];
  brandingPolicy?: TenantBrandingPolicy;
}

export interface NotificationTenantDirectory {
  resolve(recipient: string): Promise<NotificationRecipientContext | undefined>;
}

/**
 * End-client projections keyed by the templates the platform actually sends.
 *
 * `endClientPayloadAllowList` below is keyed by `LifecycleNotification`'s
 * template union, and nothing in production ever produces one of those names --
 * the alert planner emits `renewals.term_end.v1` and its siblings. That
 * mismatch is why the redaction had no effect on a real message. These entries
 * are the delivered names, and they are read on the delivery path rather than
 * compared against another list.
 *
 * A template with no entry falls back to the narrower generic allow-list, so an
 * unregistered template cannot leak a commercial field to an end client and no
 * send is refused for want of an entry.
 */
export const deliveredEndClientProjections: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  "renewals.term_end.v1": ["subjectId", "window", "boundaryAt"],
  "renewals.notice_window.v1": ["subjectId", "window", "boundaryAt"],
  "pocs.milestone.v1": ["subjectId", "window", "boundaryAt"],
  "quotes.expiry.v1": ["subjectId", "window", "boundaryAt"],
});

export function projectDeliveredEndClientData(
  template: string,
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const allowed =
    deliveredEndClientProjections[template] ?? genericEndClientAllowList;
  return Object.freeze(pickAllowed(data, new Set(allowed)));
}

/**
 * Applies white-label branding and end-client redaction to every message the
 * production composition sends.
 *
 * `CoreNotificationAdapter` hard-codes the first-party sender, so a partner
 * reselling under its own brand had its end client emailed by Fil One. This
 * decorator sits between that adapter and the provider client: it resolves the
 * recipient, replaces the brand with `resolveBrand`'s answer for that tenant,
 * and narrows the payload for an end client.
 *
 * It refuses no recipient and narrows no payload except an end client's. An
 * address the directory cannot place keeps the brand the caller chose, which is
 * the behaviour that shipped, so the only recipients whose message changes are
 * the ones the defect was about.
 *
 * A directory that cannot answer at all does propagate: the lifecycle effect
 * fails and retries rather than falling back to the first-party sender, because
 * an unknown tenant is exactly the case that must not be assumed first-party.
 */
export class TenantBrandedNotificationClient implements NotificationProviderClient {
  public constructor(
    private readonly inner: NotificationProviderClient,
    private readonly directory: () => NotificationTenantDirectory | undefined,
  ) {}

  public async send(input: {
    template: string;
    recipient: string;
    data: Readonly<Record<string, unknown>>;
    brand: ResolvedBrand;
    idempotencyKey: string;
  }): Promise<{ messageId: string }> {
    const directory = this.directory();
    // The directory is bound when the worker composes against its runtime
    // handle. Sending before that would silently fall back to the first-party
    // sender, which is the defect this class exists to close.
    if (!directory) throw new Error("NOTIFICATION_TENANT_DIRECTORY_UNBOUND");
    const context = await directory.resolve(input.recipient);
    if (!context) return this.inner.send(input);
    return this.inner.send({
      ...input,
      brand: resolveBrand(context.brandingPolicy, context.communicationOwner),
      data:
        context.audience === "end_client"
          ? projectDeliveredEndClientData(input.template, input.data)
          : input.data,
    });
  }
}

type NotificationTemplate = LifecycleNotification["template"];

const endClientPayloadAllowList: Readonly<
  Partial<Record<NotificationTemplate, readonly string[]>>
> = Object.freeze({
  "end-client-invitation": [
    "organizationName",
    "activationUrl",
    "expiresAt",
    "productName",
    "supportUrl",
    "permittedData",
  ],
  "provisioning-completed": [
    "organizationName",
    "productName",
    "accessUrl",
    "supportUrl",
    "tenantName",
  ],
  "provisioning-failed": [
    "organizationName",
    "productName",
    "supportUrl",
    "incidentReference",
  ],
  "poc-milestone": [
    "organizationName",
    "productName",
    "milestoneName",
    "milestoneStatus",
    "supportUrl",
  ],
  "offboarding-update": [
    "organizationName",
    "productName",
    "status",
    "retrievalDeadline",
    "supportUrl",
  ],
});

const genericEndClientAllowList = [
  "organizationName",
  "productName",
  "supportUrl",
  "permittedData",
] as const;

export function projectEndClientData(
  template: NotificationTemplate,
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const allowed = endClientPayloadAllowList[template];
  if (!allowed)
    throw new Error(
      `Template ${template} is not approved for end-client delivery`,
    );
  return Object.freeze(pickAllowed(data, new Set(allowed)));
}

export function redactCommercialData(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(pickAllowed(data, new Set(genericEndClientAllowList)));
}

function pickAllowed(
  data: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, cloneSafeValue(value)]),
  );
}

function cloneSafeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneSafeValue);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  throw new Error(
    "End-client notification allow-listed fields must contain JSON scalar values or arrays",
  );
}

function validateNotification(
  input: LifecycleNotification,
): ProviderResult<never> | null {
  if (input.recipients.length === 0)
    return permanent(
      "RECIPIENT_REQUIRED",
      "At least one recipient is required",
    );
  if (
    input.communicationOwner === "partner" &&
    input.recipients.some((item) => item.audience === "customer")
  )
    return permanent(
      "COMMUNICATION_OWNER_SCOPE",
      "Partner-owned communication cannot target direct customer audiences",
    );
  if (
    input.template === "end-client-invitation" &&
    input.recipients.some((item) => item.audience !== "end_client")
  )
    return permanent(
      "END_CLIENT_AUDIENCE_REQUIRED",
      "End-client invitations can only target end-client recipients",
    );
  if (
    input.recipients.some((item) => item.audience === "end_client") &&
    !endClientPayloadAllowList[input.template]
  )
    return permanent(
      "END_CLIENT_TEMPLATE_FORBIDDEN",
      "Commercial lifecycle templates cannot be delivered to end clients",
    );
  if (input.recipients.some((item) => item.audience === "end_client")) {
    try {
      projectEndClientData(input.template, input.data);
    } catch (error) {
      return permanent(
        "END_CLIENT_PAYLOAD_INVALID",
        error instanceof Error
          ? error.message
          : "End-client payload does not match the public projection",
      );
    }
  }
  return null;
}

function isDomain(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    value,
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}
