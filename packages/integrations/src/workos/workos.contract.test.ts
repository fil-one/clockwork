import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  FakeWorkosIdentityAdapter,
  WorkosRegistrationBootstrapVerifier,
} from "./index";

const organizationId = ids.organization.parse(
  "30000000-0000-4000-8000-000000000301",
);
const userId = ids.user.parse("20000000-0000-4000-8000-000000000301");

describe("WorkOS lifecycle provider contract", () => {
  it("exchanges a one-time registration code and derives trusted identity/domain evidence", async () => {
    const exchange = {
      exchange: vi.fn().mockResolvedValue({
        id: "user_workos_registration_301",
        email: "Owner@Acme.Example",
        emailVerified: true,
        impersonated: false,
      }),
    };
    const verifier = new WorkosRegistrationBootstrapVerifier(
      exchange,
      () => new Date("2026-07-31T18:00:00.000Z"),
    );

    await expect(
      verifier.verify({
        token: "one-time-workos-authorization-code",
        email: "owner@acme.example",
        businessDomain: "ACME.EXAMPLE",
        requestId: "registration-request-301",
      }),
    ).resolves.toEqual({
      actor: { kind: "user", id: "workos:user_workos_registration_301" },
      workosUserId: "user_workos_registration_301",
      domainVerifiedAt: "2026-07-31T18:00:00.000Z",
    });
    expect(exchange.exchange).toHaveBeenCalledWith(
      "one-time-workos-authorization-code",
    );
  });

  it.each([
    {
      name: "unverified WorkOS email",
      identity: {
        id: "user_1",
        email: "owner@acme.example",
        emailVerified: false,
        impersonated: false,
      },
      email: "owner@acme.example",
      domain: "acme.example",
    },
    {
      name: "user-asserted email mismatch",
      identity: {
        id: "user_1",
        email: "owner@acme.example",
        emailVerified: true,
        impersonated: false,
      },
      email: "attacker@acme.example",
      domain: "acme.example",
    },
    {
      name: "business-domain mismatch",
      identity: {
        id: "user_1",
        email: "owner@acme.example",
        emailVerified: true,
        impersonated: false,
      },
      email: "owner@acme.example",
      domain: "attacker.example",
    },
    {
      name: "impersonated registration",
      identity: {
        id: "user_1",
        email: "owner@acme.example",
        emailVerified: true,
        impersonated: true,
      },
      email: "owner@acme.example",
      domain: "acme.example",
    },
  ])("rejects $name", async ({ identity, email, domain }) => {
    const verifier = new WorkosRegistrationBootstrapVerifier({
      exchange: vi.fn().mockResolvedValue(identity),
    });
    await expect(
      verifier.verify({
        token: "one-time-workos-authorization-code",
        email,
        businessDomain: domain,
        requestId: "registration-request-302",
      }),
    ).rejects.toThrow();
  });

  it("creates organizations and invitations idempotently, verifies domains, and enforces MFA switching", async () => {
    const adapter = new FakeWorkosIdentityAdapter();
    const organizationKey = IdempotencyKeySchema.parse(
      "workos:org:contract:301",
    );
    const first = await adapter.createOrganization({
      commerceOrganizationId: organizationId,
      legalName: "Acme Storage LLC",
      idempotencyKey: organizationKey,
    });
    const replay = await adapter.createOrganization({
      commerceOrganizationId: organizationId,
      legalName: "Acme Storage LLC",
      idempotencyKey: organizationKey,
    });
    expect(first.ok && replay.ok && first.value.id === replay.value.id).toBe(
      true,
    );
    if (!first.ok) throw new Error("expected organization");

    adapter.authorizeDomain("acme.example", "dns-token");
    await expect(
      adapter.verifyBusinessDomain({
        organizationId: first.value.id,
        domain: "HTTPS://ACME.EXAMPLE/login",
        verificationToken: "dns-token",
      }),
    ).resolves.toMatchObject({ ok: true, value: { verified: true } });

    const invitation = await adapter.inviteMember({
      organizationId: first.value.id,
      email: "OWNER@ACME.EXAMPLE",
      commerceRole: "owner",
      idempotencyKey: IdempotencyKeySchema.parse("workos:invite:contract:301"),
    });
    if (!invitation.ok) throw new Error("expected invitation");
    adapter.activateInvitation(invitation.value.id, "workos_user_301");

    await expect(
      adapter.switchAccount({
        userId,
        externalUserId: "workos_user_301",
        organizationId: first.value.id,
        commerceRole: "owner",
        mfaSatisfied: false,
      }),
    ).resolves.toMatchObject({ ok: false, code: "MFA_REQUIRED" });
    await expect(
      adapter.switchAccount({
        userId,
        externalUserId: "workos_user_301",
        organizationId: first.value.id,
        commerceRole: "owner",
        mfaSatisfied: true,
      }),
    ).resolves.toMatchObject({ ok: true, value: { commerceRole: "owner" } });
  });

  it("does not infer commerce authorization from an external role slug", async () => {
    const adapter = new FakeWorkosIdentityAdapter();
    const created = await adapter.createOrganization({
      commerceOrganizationId: organizationId,
      legalName: "Role Boundary LLC",
      idempotencyKey: IdempotencyKeySchema.parse("workos:org:role-boundary"),
    });
    if (!created.ok) throw new Error("expected organization");
    const invite = await adapter.inviteMember({
      organizationId: created.value.id,
      email: "seller@role-boundary.example",
      commerceRole: "partner_seller",
      idempotencyKey: IdempotencyKeySchema.parse("workos:invite:role-boundary"),
    });
    if (!invite.ok) throw new Error("expected invite");
    expect(invite.value.externalRoleSlug).toBe("partner-seller");
    adapter.activateInvitation(invite.value.id, "external-user");
    const switched = await adapter.switchAccount({
      userId,
      externalUserId: "external-user",
      organizationId: created.value.id,
      commerceRole: "member",
      mfaSatisfied: true,
    });
    expect(switched).toMatchObject({
      ok: true,
      value: { commerceRole: "member" },
    });
  });
});
