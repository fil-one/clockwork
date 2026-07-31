import { describe, expect, it, vi } from "vitest";

import {
  WorkosSdkOrganizationClient,
  type WorkosManagementSdk,
} from "./management-client";

function sdk(): WorkosManagementSdk {
  const organization = {
    id: "org_workos_1",
    name: "Example, Inc.",
    externalId: "00000000-0000-4000-8000-000000000001",
    domains: [
      {
        id: "domain_1",
        domain: "example.com",
        state: "pending" as const,
        verificationToken: "workos-verification-token",
      },
    ],
  };
  const domain = organization.domains[0];
  if (!domain) throw new Error("Test WorkOS domain is required");
  return {
    organizations: {
      createOrganization: () => Promise.resolve(organization),
      getOrganization: () => Promise.resolve(organization),
    },
    organizationDomains: {
      createOrganizationDomain: () => Promise.resolve(domain),
      verifyOrganizationDomain: () =>
        Promise.resolve({ ...domain, state: "verified" }),
    },
    userManagement: {
      listInvitations: () =>
        Promise.resolve({ autoPagination: () => Promise.resolve([]) }),
      sendInvitation: () =>
        Promise.resolve({ id: "invitation_1", state: "pending" }),
      listOrganizationMemberships: () =>
        Promise.resolve({
          autoPagination: () =>
            Promise.resolve([
              {
                id: "membership_1",
                organizationId: "org_workos_1",
                userId: "user_workos_1",
                status: "active" as const,
                role: { slug: "admin" },
              },
            ]),
        }),
    },
  };
}

describe("WorkosSdkOrganizationClient", () => {
  it("uses WorkOS organization/domain/membership APIs and a real MFA boundary", async () => {
    const enforce = vi.fn(() => Promise.resolve());
    const client = new WorkosSdkOrganizationClient({
      client: sdk(),
      mfaPolicyEnforcer: { enforce },
    });

    await expect(
      client.createOrganization({
        name: "Example, Inc.",
        externalId: "00000000-0000-4000-8000-000000000001",
        idempotencyKey: "workos:organization:123456",
      }),
    ).resolves.toEqual({ id: "org_workos_1" });
    await expect(
      client.addVerifiedDomain({
        organizationId: "org_workos_1",
        domain: "example.com",
        verificationToken: "workos-verification-token",
      }),
    ).resolves.toEqual({ verified: true });
    await client.updateMfaPolicy({
      organizationId: "org_workos_1",
      policy: "required",
      idempotencyKey: "workos:mfa:123456789",
    });
    expect(enforce).toHaveBeenCalledWith({
      organizationId: "org_workos_1",
      policy: "required",
      idempotencyKey: "workos:mfa:123456789",
    });
    await expect(
      client.listMemberships({ organizationId: "org_workos_1" }),
    ).resolves.toEqual([
      {
        id: "membership_1",
        organizationId: "org_workos_1",
        userId: "user_workos_1",
        status: "active",
        externalRoleSlug: "admin",
      },
    ]);
  });

  it("fails closed when the domain verification token is not provider-issued", async () => {
    const client = new WorkosSdkOrganizationClient({
      client: sdk(),
      mfaPolicyEnforcer: { enforce: () => Promise.resolve() },
    });
    await expect(
      client.addVerifiedDomain({
        organizationId: "org_workos_1",
        domain: "example.com",
        verificationToken: "attacker-controlled-token",
      }),
    ).rejects.toThrow("WORKOS_DOMAIN_VERIFICATION_TOKEN_INVALID");
  });
});
