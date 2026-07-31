import { createHash } from "node:crypto";

import type {
  IdempotencyKey,
  OrganizationId,
  ProviderResult,
  UserId,
} from "@clockwork/contracts";
import { ids } from "@clockwork/contracts";
import { WorkOS } from "@workos-inc/node";

export type CommerceRole =
  "owner" | "admin" | "billing" | "member" | "partner_admin" | "partner_seller";

export type MfaPolicy = "required" | "inherited_from_sso";

export interface WorkosOrganization {
  id: string;
  commerceOrganizationId: OrganizationId;
  name: string;
  verifiedDomains: readonly string[];
  mfaPolicy: MfaPolicy;
}

export interface WorkosMembership {
  id: string;
  organizationId: string;
  userId: string;
  status: "active" | "inactive";
  externalRoleSlug: string;
}

export interface WorkosInvitation {
  id: string;
  organizationId: string;
  email: string;
  externalRoleSlug: string;
  state: "pending" | "accepted" | "revoked";
}

export interface AccountSwitchResult {
  localUserId: UserId;
  externalUserId: string;
  organization: WorkosOrganization;
  membership: WorkosMembership;
  /** Commerce remains authoritative; this is the requested local role, not a WorkOS grant. */
  commerceRole: CommerceRole;
}

export interface WorkosIdentityPort {
  createOrganization(input: {
    commerceOrganizationId: OrganizationId;
    legalName: string;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<WorkosOrganization>>;
  verifyBusinessDomain(input: {
    organizationId: string;
    domain: string;
    verificationToken: string;
  }): Promise<ProviderResult<{ domain: string; verified: boolean }>>;
  setMfaPolicy(input: {
    organizationId: string;
    policy: MfaPolicy;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<{ policy: MfaPolicy }>>;
  inviteMember(input: {
    organizationId: string;
    email: string;
    commerceRole: CommerceRole;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<WorkosInvitation>>;
  listMemberships(input: {
    organizationId: string;
  }): Promise<ProviderResult<readonly WorkosMembership[]>>;
  switchAccount(input: {
    userId: UserId;
    externalUserId: string;
    organizationId: string;
    commerceRole: CommerceRole;
    mfaSatisfied: boolean;
  }): Promise<ProviderResult<AccountSwitchResult>>;
}

export interface WorkosClient {
  createOrganization(input: {
    name: string;
    externalId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  addVerifiedDomain(input: {
    organizationId: string;
    domain: string;
    verificationToken: string;
  }): Promise<{ verified: boolean }>;
  updateMfaPolicy(input: {
    organizationId: string;
    policy: MfaPolicy;
    idempotencyKey: string;
  }): Promise<void>;
  createInvitation(input: {
    organizationId: string;
    email: string;
    roleSlug: string;
    idempotencyKey: string;
  }): Promise<{ id: string; state: "pending" | "accepted" | "revoked" }>;
  listMemberships(input: {
    organizationId: string;
  }): Promise<readonly WorkosMembership[]>;
  getOrganization(input: { organizationId: string }): Promise<{
    id: string;
    name: string;
    externalId: string;
    verifiedDomains: readonly string[];
    mfaPolicy: MfaPolicy;
  }>;
}

export interface WorkosRoleMapping {
  toExternalRole(role: CommerceRole): string;
}

export class FixedWorkosRoleMapping implements WorkosRoleMapping {
  public constructor(
    private readonly mapping: Readonly<Record<CommerceRole, string>>,
  ) {}

  public toExternalRole(role: CommerceRole): string {
    return this.mapping[role];
  }
}

const defaultRoleMapping = new FixedWorkosRoleMapping({
  owner: "owner",
  admin: "admin",
  billing: "billing",
  member: "member",
  partner_admin: "partner-admin",
  partner_seller: "partner-seller",
});

const failure = (code: string, message: string): ProviderResult<never> => ({
  ok: false,
  kind: "permanent",
  code,
  message,
});

export class WorkosIdentityAdapter implements WorkosIdentityPort {
  public constructor(
    private readonly client: WorkosClient,
    private readonly roles: WorkosRoleMapping = defaultRoleMapping,
  ) {}

  public async createOrganization(
    input: Parameters<WorkosIdentityPort["createOrganization"]>[0],
  ): Promise<ProviderResult<WorkosOrganization>> {
    try {
      const created = await this.client.createOrganization({
        name: input.legalName,
        externalId: input.commerceOrganizationId,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true,
        value: {
          id: created.id,
          commerceOrganizationId: input.commerceOrganizationId,
          name: input.legalName,
          verifiedDomains: [],
          mfaPolicy: "required",
        },
      };
    } catch (error) {
      return providerFailure(error);
    }
  }

  public async verifyBusinessDomain(
    input: Parameters<WorkosIdentityPort["verifyBusinessDomain"]>[0],
  ): Promise<ProviderResult<{ domain: string; verified: boolean }>> {
    const domain = normalizeDomain(input.domain);
    if (!isBusinessDomain(domain))
      return failure(
        "BUSINESS_DOMAIN_REQUIRED",
        "Consumer and local email domains cannot be organization domains",
      );
    try {
      const result = await this.client.addVerifiedDomain({ ...input, domain });
      return { ok: true, value: { domain, verified: result.verified } };
    } catch (error) {
      return providerFailure(error);
    }
  }

  public async setMfaPolicy(
    input: Parameters<WorkosIdentityPort["setMfaPolicy"]>[0],
  ): Promise<ProviderResult<{ policy: MfaPolicy }>> {
    try {
      await this.client.updateMfaPolicy({
        organizationId: input.organizationId,
        policy: input.policy,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true, value: { policy: input.policy } };
    } catch (error) {
      return providerFailure(error);
    }
  }

  public async inviteMember(
    input: Parameters<WorkosIdentityPort["inviteMember"]>[0],
  ): Promise<ProviderResult<WorkosInvitation>> {
    try {
      const externalRoleSlug = this.roles.toExternalRole(input.commerceRole);
      const invite = await this.client.createInvitation({
        organizationId: input.organizationId,
        email: input.email.toLowerCase(),
        roleSlug: externalRoleSlug,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: true,
        value: {
          id: invite.id,
          organizationId: input.organizationId,
          email: input.email.toLowerCase(),
          externalRoleSlug,
          state: invite.state,
        },
      };
    } catch (error) {
      return providerFailure(error);
    }
  }

  public async listMemberships(
    input: Parameters<WorkosIdentityPort["listMemberships"]>[0],
  ): Promise<ProviderResult<readonly WorkosMembership[]>> {
    try {
      return {
        ok: true,
        value: await this.client.listMemberships(input),
      };
    } catch (error) {
      return providerFailure(error);
    }
  }

  public async switchAccount(
    input: Parameters<WorkosIdentityPort["switchAccount"]>[0],
  ): Promise<ProviderResult<AccountSwitchResult>> {
    try {
      const [organization, memberships] = await Promise.all([
        this.client.getOrganization({ organizationId: input.organizationId }),
        this.client.listMemberships({
          organizationId: input.organizationId,
        }),
      ]);
      const membership = memberships.find(
        (item) =>
          item.userId === input.externalUserId && item.status === "active",
      );
      if (!membership)
        return failure(
          "ACTIVE_MEMBERSHIP_REQUIRED",
          "The user has no active membership in the requested organization",
        );
      if (organization.mfaPolicy === "required" && !input.mfaSatisfied)
        return failure(
          "MFA_REQUIRED",
          "MFA must be satisfied before switching organizations",
        );
      return {
        ok: true,
        value: {
          localUserId: input.userId,
          externalUserId: input.externalUserId,
          organization: {
            id: organization.id,
            commerceOrganizationId: ids.organization.parse(
              organization.externalId,
            ),
            name: organization.name,
            verifiedDomains: organization.verifiedDomains,
            mfaPolicy: organization.mfaPolicy,
          },
          membership,
          commerceRole: input.commerceRole,
        },
      };
    } catch (error) {
      return providerFailure(error);
    }
  }
}

export interface FakeWorkosOptions {
  now?: () => string;
}

export class FakeWorkosIdentityAdapter implements WorkosIdentityPort {
  private readonly organizations = new Map<string, WorkosOrganization>();
  private readonly organizationKeys = new Map<string, string>();
  private readonly memberships = new Map<string, WorkosMembership[]>();
  private readonly invitations = new Map<string, WorkosInvitation>();
  private readonly inviteKeys = new Map<string, string>();
  private readonly domainTokens = new Map<string, string>();

  public constructor(
    private readonly roles: WorkosRoleMapping = defaultRoleMapping,
    _options: FakeWorkosOptions = {},
  ) {}

  public authorizeDomain(domain: string, token: string): void {
    this.domainTokens.set(normalizeDomain(domain), token);
  }

  public activateInvitation(
    invitationId: string,
    externalUserId: string,
  ): void {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) throw new Error(`Unknown invitation ${invitationId}`);
    this.invitations.set(invitationId, {
      ...invitation,
      state: "accepted",
    });
    const current = this.memberships.get(invitation.organizationId) ?? [];
    current.push({
      id: stableId("membership", `${invitationId}:${externalUserId}`),
      organizationId: invitation.organizationId,
      userId: externalUserId,
      status: "active",
      externalRoleSlug: invitation.externalRoleSlug,
    });
    this.memberships.set(invitation.organizationId, current);
  }

  public deactivateMembership(organizationId: string, externalUserId: string) {
    const current = this.memberships.get(organizationId) ?? [];
    this.memberships.set(
      organizationId,
      current.map((item) =>
        item.userId === externalUserId
          ? { ...item, status: "inactive" as const }
          : item,
      ),
    );
  }

  public createOrganization(
    input: Parameters<WorkosIdentityPort["createOrganization"]>[0],
  ): Promise<ProviderResult<WorkosOrganization>> {
    const fingerprint = JSON.stringify({
      commerceOrganizationId: input.commerceOrganizationId,
      legalName: input.legalName,
    });
    const prior = this.organizationKeys.get(input.idempotencyKey);
    if (prior !== undefined && prior !== fingerprint)
      return Promise.resolve(
        failure(
          "IDEMPOTENCY_CONFLICT",
          "The organization key was reused with different input",
        ),
      );
    const id = stableId("org", input.idempotencyKey);
    const existing = this.organizations.get(id);
    if (existing)
      return Promise.resolve({ ok: true, value: existing, duplicate: true });
    const organization: WorkosOrganization = {
      id,
      commerceOrganizationId: input.commerceOrganizationId,
      name: input.legalName,
      verifiedDomains: [],
      mfaPolicy: "required",
    };
    this.organizationKeys.set(input.idempotencyKey, fingerprint);
    this.organizations.set(id, organization);
    return Promise.resolve({ ok: true, value: organization });
  }

  public verifyBusinessDomain(
    input: Parameters<WorkosIdentityPort["verifyBusinessDomain"]>[0],
  ): Promise<ProviderResult<{ domain: string; verified: boolean }>> {
    const organization = this.organizations.get(input.organizationId);
    if (!organization)
      return Promise.resolve(failure("NOT_FOUND", "Organization not found"));
    const domain = normalizeDomain(input.domain);
    if (!isBusinessDomain(domain))
      return Promise.resolve(
        failure("BUSINESS_DOMAIN_REQUIRED", "A business domain is required"),
      );
    const verified = this.domainTokens.get(domain) === input.verificationToken;
    if (!verified)
      return Promise.resolve({ ok: true, value: { domain, verified } });
    this.organizations.set(input.organizationId, {
      ...organization,
      verifiedDomains: [...new Set([...organization.verifiedDomains, domain])],
    });
    return Promise.resolve({ ok: true, value: { domain, verified } });
  }

  public setMfaPolicy(
    input: Parameters<WorkosIdentityPort["setMfaPolicy"]>[0],
  ): Promise<ProviderResult<{ policy: MfaPolicy }>> {
    const organization = this.organizations.get(input.organizationId);
    if (!organization)
      return Promise.resolve(failure("NOT_FOUND", "Organization not found"));
    this.organizations.set(input.organizationId, {
      ...organization,
      mfaPolicy: input.policy,
    });
    return Promise.resolve({ ok: true, value: { policy: input.policy } });
  }

  public inviteMember(
    input: Parameters<WorkosIdentityPort["inviteMember"]>[0],
  ): Promise<ProviderResult<WorkosInvitation>> {
    if (!this.organizations.has(input.organizationId))
      return Promise.resolve(failure("NOT_FOUND", "Organization not found"));
    const fingerprint = JSON.stringify({
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      commerceRole: input.commerceRole,
    });
    const prior = this.inviteKeys.get(input.idempotencyKey);
    if (prior !== undefined && prior !== fingerprint)
      return Promise.resolve(
        failure(
          "IDEMPOTENCY_CONFLICT",
          "The invitation key was reused with different input",
        ),
      );
    const id = stableId("invite", input.idempotencyKey);
    const existing = this.invitations.get(id);
    if (existing)
      return Promise.resolve({ ok: true, value: existing, duplicate: true });
    const invitation: WorkosInvitation = {
      id,
      organizationId: input.organizationId,
      email: input.email.toLowerCase(),
      externalRoleSlug: this.roles.toExternalRole(input.commerceRole),
      state: "pending",
    };
    this.inviteKeys.set(input.idempotencyKey, fingerprint);
    this.invitations.set(id, invitation);
    return Promise.resolve({ ok: true, value: invitation });
  }

  public listMemberships(
    input: Parameters<WorkosIdentityPort["listMemberships"]>[0],
  ): Promise<ProviderResult<readonly WorkosMembership[]>> {
    return Promise.resolve({
      ok: true,
      value: [...(this.memberships.get(input.organizationId) ?? [])],
    });
  }

  public switchAccount(
    input: Parameters<WorkosIdentityPort["switchAccount"]>[0],
  ): Promise<ProviderResult<AccountSwitchResult>> {
    const organization = this.organizations.get(input.organizationId);
    if (!organization)
      return Promise.resolve(failure("NOT_FOUND", "Organization not found"));
    const membership = (this.memberships.get(input.organizationId) ?? []).find(
      (item) =>
        item.userId === input.externalUserId && item.status === "active",
    );
    if (!membership)
      return Promise.resolve(
        failure("ACTIVE_MEMBERSHIP_REQUIRED", "Active membership is required"),
      );
    if (organization.mfaPolicy === "required" && !input.mfaSatisfied)
      return Promise.resolve(failure("MFA_REQUIRED", "MFA is required"));
    return Promise.resolve({
      ok: true,
      value: {
        localUserId: input.userId,
        externalUserId: input.externalUserId,
        organization,
        membership,
        commerceRole: input.commerceRole,
      },
    });
  }
}

export function normalizeDomain(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0] ?? ""
  );
}

export function isBusinessDomain(domain: string): boolean {
  const consumerDomains = new Set([
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "icloud.com",
    "localhost",
  ]);
  return domain.includes(".") && !consumerDomains.has(domain);
}

export interface WorkosRegistrationIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
  impersonated: boolean;
}

/** Narrow boundary so authorization-code exchange is independently testable. */
export interface WorkosRegistrationCodeExchange {
  exchange(code: string): Promise<WorkosRegistrationIdentity>;
}

/**
 * Confidential WorkOS authorization-code exchange. The returned access and
 * refresh tokens intentionally never cross this boundary.
 */
export class WorkosAuthorizationCodeExchange implements WorkosRegistrationCodeExchange {
  private readonly workos: WorkOS;

  public constructor(
    apiKey: string,
    private readonly clientId: string,
  ) {
    if (!apiKey.startsWith("sk_"))
      throw new Error("A WorkOS server API key is required");
    if (!clientId.trim()) throw new Error("A WorkOS client ID is required");
    this.workos = new WorkOS(apiKey);
  }

  public async exchange(code: string): Promise<WorkosRegistrationIdentity> {
    const response = await this.workos.userManagement.authenticateWithCode({
      code,
      clientId: this.clientId,
    });
    return {
      id: response.user.id,
      email: response.user.email,
      emailVerified: response.user.emailVerified,
      impersonated: response.impersonator !== undefined,
    };
  }
}

/**
 * Verifies first-account registration without trusting request-owned identity
 * or organization identifiers. WorkOS authorization codes are one-time tokens;
 * they are exchanged only by the confidential server client.
 */
export class WorkosRegistrationBootstrapVerifier {
  public constructor(
    private readonly exchange: WorkosRegistrationCodeExchange,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async verify(input: {
    token: string;
    email: string;
    businessDomain: string;
    requestId: string;
  }) {
    const identity = await this.exchange.exchange(input.token);
    if (identity.impersonated)
      throw new Error("Impersonation cannot bootstrap an organization");
    if (!identity.emailVerified)
      throw new Error("A verified WorkOS email is required");

    const assertedEmail = input.email.trim().toLowerCase();
    const verifiedEmail = identity.email.trim().toLowerCase();
    if (assertedEmail !== verifiedEmail)
      throw new Error("Registration email does not match WorkOS identity");

    const separator = verifiedEmail.lastIndexOf("@");
    const verifiedDomain = normalizeDomain(verifiedEmail.slice(separator + 1));
    const businessDomain = normalizeDomain(input.businessDomain);
    if (
      separator <= 0 ||
      !isBusinessDomain(businessDomain) ||
      verifiedDomain !== businessDomain
    )
      throw new Error(
        "Verified WorkOS email must match the registered business domain",
      );

    return {
      actor: { kind: "user" as const, id: `workos:${identity.id}` },
      workosUserId: identity.id,
      domainVerifiedAt: this.now().toISOString(),
    };
  }
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function providerFailure(error: unknown): ProviderResult<never> {
  const message =
    error instanceof Error ? error.message : "Unknown provider error";
  return {
    ok: false,
    kind: "transient",
    code: "WORKOS_PROVIDER_ERROR",
    message,
  };
}
