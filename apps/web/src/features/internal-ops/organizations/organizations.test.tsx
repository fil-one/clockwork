import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingOrganizationDetail } from "@clockwork/db";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  session: vi.fn(),
  revalidate: vi.fn(),
  repository: { create: vi.fn() },
  invites: { createAsStaff: vi.fn(), revokeAsStaff: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/src/db/service", () => ({ getServiceDatabase: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./server", () => ({
  onboardingRepository: () => mocks.repository,
  organizationInviteRepository: () => mocks.invites,
}));

import { createOrganization, inviteToOrganization } from "./actions";
import { resolveCountry } from "./model";
import { OrganizationForm } from "./organization-form";
import { OrganizationInvites } from "./organization-invites";
import {
  HandoffOrganizationStep,
  OrganizationDetail,
  OrganizationList,
  OrganizationPageState,
} from "./organization-views";

const handoffId = "019a44ac-0000-7000-8000-0000000000e1";
const organizationId = "019a44ac-0000-7000-8000-0000000000f1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setting up an organization", () => {
  const defaults = {
    handoffRequestId: handoffId,
    legalName: "Bluefin Data Co.",
    side: "channel_partner" as const,
    billingName: "Alex Example",
    billingEmail: "alex@bluefin.test",
    domain: "bluefin.test",
  };
  const fill = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  const asOperator = () =>
    mocks.session.mockResolvedValue({
      userId: "u",
      profile: { name: "Ops" },
      roles: ["internal_operator"],
      isInternalStaff: true,
      mfaVerified: true,
    });

  it("prefills from the handoff and sends one structured request", async () => {
    asOperator();
    mocks.repository.create.mockResolvedValue({ organizationId });
    render(<OrganizationForm defaults={defaults} />);
    expect(screen.getByLabelText(/Legal name/u)).toHaveValue(
      "Bluefin Data Co.",
    );
    expect(screen.getByLabelText(/Business domain/u)).toHaveValue(
      "bluefin.test",
    );
    expect(screen.getByLabelText(/How the partner sells/u)).toHaveValue(
      "resale",
    );
    fill(/^Country/u, "gb");
    expect(screen.getByText("United Kingdom")).toBeInTheDocument();
    fill(/Street address/u, "1 Archive Way");
    fill(/City/u, "London");
    fill(/Postal code/u, "EC1A 1AA");
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    await waitFor(() => expect(mocks.repository.create).toHaveBeenCalledOnce());
    expect(mocks.repository.create.mock.calls[0]?.[0]).toMatchObject({
      handoffRequestId: handoffId,
      legalName: "Bluefin Data Co.",
      side: "channel_partner",
      channelAgreementType: "resale",
      country: "GB",
      currency: "USD",
      domain: "bluefin.test",
      registeredAddress: {
        line1: "1 Archive Way",
        city: "London",
        postalCode: "EC1A 1AA",
      },
      billingContact: { name: "Alex Example", email: "alex@bluefin.test" },
      invoiceDeliveryEmail: "alex@bluefin.test",
    });
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        `/internal/organizations/${organizationId}?created=1`,
      ),
    );
  });

  it("words a refusal and keeps the reader on the form", async () => {
    mocks.repository.create.mockRejectedValue(
      new Error("ONBOARDING_DOMAIN_TAKEN"),
    );
    asOperator();
    render(<OrganizationForm defaults={{ ...defaults, side: "customer" }} />);
    expect(
      screen.queryByLabelText(/How the partner sells/u),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    expect(
      await screen.findByText(
        "Another account already uses this business domain.",
      ),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("the country field", () => {
  it("names a two-letter code and refuses codes that name no country", () => {
    expect(resolveCountry("gb")).toBe("United Kingdom");
    expect(resolveCountry(" US ")).toBe("United States");
    for (const code of ["AA", "XX", "ZZ", "G", "G1", ""])
      expect(resolveCountry(code)).toBeNull();
  });

  it("keeps a code no country uses from reaching the server", () => {
    render(
      <OrganizationForm
        defaults={{
          handoffRequestId: null,
          legalName: "Bluefin Data Co.",
          side: "customer",
          billingName: "",
          billingEmail: "",
          domain: "",
        }}
      />,
    );
    const country = screen.getByLabelText(/^Country/u);
    fireEvent.change(country, { target: { value: "AA" } });
    expect(
      screen.getByText("Two-letter code, for example US or GB."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    expect(country).toHaveAttribute("aria-invalid", "true");
    expect(mocks.repository.create).not.toHaveBeenCalled();
  });
});

describe("createOrganization", () => {
  const as = (role: string) =>
    mocks.session.mockResolvedValue({
      userId: "019a44ac-0000-7000-8000-0000000000aa",
      profile: { name: "Ops Person" },
      roles: [role],
      isInternalStaff: true,
      mfaVerified: true,
    });

  it("lets operations create organizations as themselves", async () => {
    mocks.repository.create.mockResolvedValue({ organizationId });
    for (const role of ["internal_operator", "commerce_admin"]) {
      as(role);
      await expect(createOrganization({ id: "x" })).resolves.toEqual({
        ok: true,
        value: { organizationId },
      });
    }
    expect(mocks.repository.create).toHaveBeenLastCalledWith(
      { id: "x" },
      {
        kind: "user",
        id: "019a44ac-0000-7000-8000-0000000000aa",
        display: "Ops Person",
      },
    );
  });

  it("refuses sellers and approvers", async () => {
    for (const role of ["revenue", "legal_approver", "finance_approver"]) {
      as(role);
      await expect(createOrganization({})).resolves.toEqual({
        ok: false,
        code: "CONTRACT_FORBIDDEN",
      });
    }
    expect(mocks.repository.create).not.toHaveBeenCalled();
  });
});

describe("the organization pages", () => {
  const organization: OnboardingOrganizationDetail = {
    organizationId,
    accountId: "019a44ac-0000-7000-8000-0000000000a1",
    legalName: "Bluefin Data Co.",
    side: "customer",
    country: "GB",
    currency: "GBP",
    domain: "bluefin.test",
    screeningStatus: "review",
    identityProviderLinked: false,
    createdAt: "2026-10-09T12:00:00.000Z",
    billingContact: { name: "Alex Example", email: "alex@bluefin.test" },
    partnerAgreementType: null,
    members: [
      {
        userId: "u1",
        name: "Alex Example",
        email: "alex@bluefin.test",
        role: "owner",
        addedAt: "2026-10-09T12:00:00.000Z",
      },
    ],
    handoffRequestIds: [handoffId],
  };

  it("lists organizations by country name and offers Create organization", async () => {
    render(
      await OrganizationList({
        state: { kind: "ready", organizations: [organization] },
        canWrite: true,
      }),
    );
    expect(screen.getAllByText("United Kingdom")).not.toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Create organization" }),
    ).toHaveAttribute("href", "/internal/organizations/new");
  });

  it("hides Create organization while the list cannot be read", async () => {
    render(
      await OrganizationList({
        state: { kind: "unavailable" },
        canWrite: true,
      }),
    );
    expect(
      screen.getByText(/Organizations could not be loaded right now/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create organization" }),
    ).not.toBeInTheDocument();
  });

  it("says set-up is unavailable on the new page instead of failing", async () => {
    render(
      await OrganizationPageState({
        heading: "operations.organizations.form.title",
        state: "unavailable",
        unavailable: "operations.organizations.form.unavailable",
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "New organization" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Organizations cannot be set up right now\. Reload the page in a minute\./u,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reads as turned off in the demo on the list, new and detail pages", async () => {
    render(await OrganizationList({ state: { kind: "demo" }, canWrite: true }));
    for (const heading of [
      "operations.organizations.form.title",
      "operations.organizations.detail.title",
    ] as const)
      render(
        await OrganizationPageState({
          heading,
          state: "demo",
          unavailable: "operations.organizations.detail.unavailable",
        }),
      );
    expect(
      screen.getAllByText("Organizations are turned off in the demo."),
    ).toHaveLength(3);
    expect(screen.queryByText(/could not be loaded/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create organization" }),
    ).not.toBeInTheDocument();
  });

  it("shows the account, its people and the handoff it came from", async () => {
    render(await OrganizationDetail({ organization, created: true }));
    expect(screen.getByText("Organization created.")).toBeInTheDocument();
    expect(
      screen.getByText("alex@bluefin.test, Account owner"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Handoff" })).toHaveAttribute(
      "href",
      `/internal/handoffs/${handoffId}`,
    );
    expect(
      screen.getAllByText("Being set up with the sign-in service"),
    ).not.toHaveLength(0);
  });

  it("offers set-up only on a handoff operations is working", async () => {
    render(
      await HandoffOrganizationStep({
        handoffId,
        organizationId: null,
        status: "in_progress",
        canWork: true,
      }),
    );
    expect(
      screen.getByRole("link", { name: "Create organization" }),
    ).toHaveAttribute(
      "href",
      `/internal/organizations/new?handoff=${handoffId}`,
    );
    expect(
      await HandoffOrganizationStep({
        handoffId,
        organizationId: null,
        status: "open",
        canWork: true,
      }),
    ).toBeNull();
    expect(
      await HandoffOrganizationStep({
        handoffId,
        organizationId: null,
        status: "in_progress",
        canWork: false,
      }),
    ).toBeNull();
  });

  it("links a handoff to the organization it produced", async () => {
    render(
      await HandoffOrganizationStep({
        handoffId,
        organizationId,
        status: "done",
        canWork: false,
      }),
    );
    expect(
      screen.getByRole("link", { name: "Open the organization" }),
    ).toHaveAttribute("href", `/internal/organizations/${organizationId}`);
  });
});

describe("invitations", () => {
  const operatorSession = () =>
    mocks.session.mockResolvedValue({
      userId: "019a44ac-0000-7000-8000-0000000000aa",
      profile: { name: "Ops Person" },
      roles: ["internal_operator"],
      isInternalStaff: true,
      mfaVerified: true,
    });

  it("creates one and shows the link to copy", async () => {
    operatorSession();
    mocks.invites.createAsStaff.mockResolvedValue({
      inviteId: "i1",
      path: `/invite/${"t".repeat(43)}`,
    });
    render(
      <OrganizationInvites
        organizationId={organizationId}
        side="customer"
        invites={[]}
        canWrite
      />,
    );
    expect(screen.getByLabelText(/Role/u)).toHaveValue("owner");
    fireEvent.change(screen.getByLabelText(/Email/u), {
      target: { value: "alex@bluefin.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(
      await screen.findByText(
        "Invitation created for alex@bluefin.test. Copy the link below and send it to them.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`http://localhost:3000/invite/${"t".repeat(43)}`),
    ).toBeInTheDocument();
    expect(mocks.invites.createAsStaff).toHaveBeenCalledWith(
      { organizationId, email: "alex@bluefin.test", role: "owner" },
      expect.objectContaining({ kind: "user", display: "Ops Person" }),
    );
  });

  it("lists invitations with their state and a link only while pending", () => {
    render(
      <OrganizationInvites
        organizationId={organizationId}
        side="channel_partner"
        invites={[
          {
            inviteId: "i1",
            email: "lead@bluefin.test",
            role: "partner_admin",
            expiresAt: "2026-10-24T00:00:00.000Z",
            acceptedAt: null,
            state: "pending",
            path: `/invite/${"p".repeat(43)}`,
          },
          {
            inviteId: "i2",
            email: "seller@bluefin.test",
            role: "partner_seller",
            expiresAt: "2026-10-20T00:00:00.000Z",
            acceptedAt: "2026-10-11T00:00:00.000Z",
            state: "accepted",
            path: null,
          },
        ]}
        canWrite={false}
      />,
    );
    expect(screen.getByText("Waiting, expires Oct 24, 2026")).toHaveClass(
      "cw-badge--warning",
    );
    expect(screen.getByText("Accepted Oct 11, 2026")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Invitation link/u }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Create invitation" }),
    ).not.toBeInTheDocument();
  });

  it("revokes a pending or void invitation", async () => {
    operatorSession();
    mocks.invites.revokeAsStaff.mockResolvedValue(undefined);
    render(
      <OrganizationInvites
        organizationId={organizationId}
        side="customer"
        invites={[
          {
            inviteId: "019a44ac-0000-7000-8000-0000000000d1",
            email: "old@bluefin.test",
            role: "owner",
            expiresAt: "2026-10-24T00:00:00.000Z",
            acceptedAt: null,
            state: "void",
            path: null,
          },
        ]}
        canWrite
      />,
    );
    const voided = screen.getByText(
      "Link no longer works. Revoke it and invite again.",
    );
    // A void invite is closed, not waiting: neutral, never amber.
    expect(voided).toHaveClass("cw-badge--neutral");
    expect(voided).not.toHaveClass("cw-badge--warning");
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke: old@bluefin.test" }),
    );
    expect(
      await screen.findByText(
        "Invitation for old@bluefin.test revoked. Its link no longer works.",
      ),
    ).toBeInTheDocument();
    expect(mocks.invites.revokeAsStaff).toHaveBeenCalledWith(
      {
        organizationId,
        inviteId: "019a44ac-0000-7000-8000-0000000000d1",
      },
      expect.objectContaining({ kind: "user" }),
    );
  });

  it("is refused to sellers and words a refusal from the database", async () => {
    mocks.session.mockResolvedValue({
      userId: "u",
      profile: { name: "Seller" },
      roles: ["revenue"],
      isInternalStaff: true,
      mfaVerified: true,
    });
    await expect(
      inviteToOrganization({
        organizationId,
        email: "a@b.test",
        role: "owner",
      }),
    ).resolves.toEqual({ ok: false, code: "CONTRACT_FORBIDDEN" });
    operatorSession();
    mocks.invites.createAsStaff.mockRejectedValue(
      new Error("INVITE_ALREADY_PENDING"),
    );
    render(
      <OrganizationInvites
        organizationId={organizationId}
        side="customer"
        invites={[]}
        canWrite
      />,
    );
    fireEvent.change(screen.getByLabelText(/Email/u), {
      target: { value: "alex@bluefin.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(
      await screen.findByText(
        "This person already has an invitation waiting. Copy its link below.",
      ),
    ).toBeInTheDocument();
  });
});
