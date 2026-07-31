import { WorkOS } from "@workos-inc/node";
import { z } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";
import type { MfaPolicy, WorkosClient, WorkosMembership } from "./index";

interface SdkOrganizationDomain {
  id: string;
  domain: string;
  state: "verified" | "pending" | "failed";
  verificationToken?: string;
}

interface SdkOrganization {
  id: string;
  name: string;
  externalId: string | null;
  domains: readonly SdkOrganizationDomain[];
}

export interface WorkosManagementSdk {
  organizations: {
    createOrganization(
      input: { name: string; externalId: string },
      options: { idempotencyKey: string },
    ): Promise<SdkOrganization>;
    getOrganization(id: string): Promise<SdkOrganization>;
  };
  organizationDomains: {
    createOrganizationDomain(input: {
      organizationId: string;
      domain: string;
    }): Promise<SdkOrganizationDomain>;
    verifyOrganizationDomain(id: string): Promise<SdkOrganizationDomain>;
  };
  userManagement: {
    listInvitations(input: { organizationId: string; email: string }): Promise<{
      autoPagination(): Promise<
        readonly {
          id: string;
          organizationId: string | null;
          email: string;
          roleSlug: string | null;
          state: "pending" | "accepted" | "expired" | "revoked";
        }[]
      >;
    }>;
    sendInvitation(input: {
      organizationId: string;
      email: string;
      roleSlug: string;
    }): Promise<{
      id: string;
      state: "pending" | "accepted" | "expired" | "revoked";
    }>;
    listOrganizationMemberships(input: {
      organizationId: string;
      statuses: ("active" | "inactive")[];
    }): Promise<{
      autoPagination(): Promise<
        readonly {
          id: string;
          organizationId: string;
          userId: string;
          status: "active" | "inactive" | "pending";
          role: { slug: string };
        }[]
      >;
    }>;
  };
}

export interface WorkosMfaPolicyEnforcer {
  enforce(input: {
    organizationId: string;
    policy: MfaPolicy;
    idempotencyKey: string;
  }): Promise<void>;
}

export class HttpWorkosMfaPolicyEnforcer implements WorkosMfaPolicyEnforcer {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async enforce(input: {
    organizationId: string;
    policy: MfaPolicy;
    idempotencyKey: string;
  }): Promise<void> {
    const result = await this.transport.request({
      operation: "workos.mfa_policy.enforce",
      path: "/v1/workos/mfa-policies",
      body: input,
      response: z.object({ enforced: z.literal(true) }),
      idempotencyKey: input.idempotencyKey,
    });
    if (!result.enforced) throw new Error("WORKOS_MFA_POLICY_NOT_ENFORCED");
  }
}

export interface WorkosManagementClientOptions {
  apiKey?: string;
  client?: WorkosManagementSdk;
  mfaPolicyEnforcer: WorkosMfaPolicyEnforcer;
}

function invitationState(
  value: "pending" | "accepted" | "expired" | "revoked",
): "pending" | "accepted" | "revoked" {
  return value === "expired" ? "revoked" : value;
}

/**
 * Production WorkOS organization-management client. WorkOS remains the source
 * for organizations, verified domains, invitations, and memberships. MFA is a
 * separate explicit enforcement boundary because WorkOS policy configuration
 * varies by selected AuthKit/SSO setup and must not be represented by metadata.
 */
export class WorkosSdkOrganizationClient implements WorkosClient {
  private readonly workos: WorkosManagementSdk;

  public constructor(private readonly options: WorkosManagementClientOptions) {
    if (!options.mfaPolicyEnforcer)
      throw new Error("WORKOS_MFA_POLICY_ENFORCER_REQUIRED");
    if (options.client) {
      this.workos = options.client;
      return;
    }
    if (!options.apiKey?.startsWith("sk_"))
      throw new Error("WORKOS_SERVER_API_KEY_REQUIRED");
    this.workos = new WorkOS(options.apiKey);
  }

  public async createOrganization(input: {
    name: string;
    externalId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    const organization = await this.workos.organizations.createOrganization(
      { name: input.name, externalId: input.externalId },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: organization.id };
  }

  public async addVerifiedDomain(input: {
    organizationId: string;
    domain: string;
    verificationToken: string;
  }): Promise<{ verified: boolean }> {
    let organization = await this.workos.organizations.getOrganization(
      input.organizationId,
    );
    let organizationDomain = organization.domains.find(
      (candidate) => candidate.domain.toLowerCase() === input.domain,
    );
    if (!organizationDomain) {
      try {
        organizationDomain =
          await this.workos.organizationDomains.createOrganizationDomain({
            organizationId: input.organizationId,
            domain: input.domain,
          });
      } catch (error) {
        organization = await this.workos.organizations.getOrganization(
          input.organizationId,
        );
        organizationDomain = organization.domains.find(
          (candidate) => candidate.domain.toLowerCase() === input.domain,
        );
        if (!organizationDomain) throw error;
      }
    }
    if (organizationDomain.state === "verified") return { verified: true };
    if (
      !organizationDomain.verificationToken ||
      organizationDomain.verificationToken !== input.verificationToken
    )
      throw new Error("WORKOS_DOMAIN_VERIFICATION_TOKEN_INVALID");
    const verified =
      await this.workos.organizationDomains.verifyOrganizationDomain(
        organizationDomain.id,
      );
    return { verified: verified.state === "verified" };
  }

  public async updateMfaPolicy(input: {
    organizationId: string;
    policy: MfaPolicy;
    idempotencyKey: string;
  }): Promise<void> {
    await this.options.mfaPolicyEnforcer.enforce(input);
  }

  public async createInvitation(input: {
    organizationId: string;
    email: string;
    roleSlug: string;
    idempotencyKey: string;
  }): Promise<{
    id: string;
    state: "pending" | "accepted" | "revoked";
  }> {
    const findExisting = async () => {
      const invitations = await this.workos.userManagement.listInvitations({
        organizationId: input.organizationId,
        email: input.email,
      });
      return (await invitations.autoPagination()).find(
        (candidate) =>
          candidate.organizationId === input.organizationId &&
          candidate.email.toLowerCase() === input.email &&
          candidate.roleSlug === input.roleSlug &&
          candidate.state !== "expired",
      );
    };
    const existing = await findExisting();
    if (existing)
      return { id: existing.id, state: invitationState(existing.state) };
    try {
      const created = await this.workos.userManagement.sendInvitation({
        organizationId: input.organizationId,
        email: input.email,
        roleSlug: input.roleSlug,
      });
      return { id: created.id, state: invitationState(created.state) };
    } catch (error) {
      // WorkOS does not expose an idempotency option for invitations. Resolve a
      // provider-side duplicate after conflict/timeout before surfacing failure.
      const recovered = await findExisting();
      if (!recovered) throw error;
      return { id: recovered.id, state: invitationState(recovered.state) };
    }
  }

  public async listMemberships(input: {
    organizationId: string;
  }): Promise<readonly WorkosMembership[]> {
    const page = await this.workos.userManagement.listOrganizationMemberships({
      organizationId: input.organizationId,
      statuses: ["active", "inactive"],
    });
    return (await page.autoPagination()).map((membership) => ({
      id: membership.id,
      organizationId: membership.organizationId,
      userId: membership.userId,
      status: membership.status === "active" ? "active" : "inactive",
      externalRoleSlug: membership.role.slug,
    }));
  }

  public async getOrganization(input: { organizationId: string }) {
    const organization = await this.workos.organizations.getOrganization(
      input.organizationId,
    );
    if (!organization.externalId)
      throw new Error("WORKOS_ORGANIZATION_EXTERNAL_ID_REQUIRED");
    return {
      id: organization.id,
      name: organization.name,
      externalId: organization.externalId,
      verifiedDomains: organization.domains
        .filter((domain) => domain.state === "verified")
        .map((domain) => domain.domain.toLowerCase()),
      // The enforcer is authoritative and every new organization is required
      // before its binding is persisted by the outbox handler.
      mfaPolicy: "required" as const,
    };
  }
}
