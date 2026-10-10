import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingOrganizationDetail } from "@clockwork/db";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  session: vi.fn(),
  revalidate: vi.fn(),
  repository: { create: vi.fn() },
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
}));

import { createOrganization } from "./actions";
import { OrganizationForm } from "./organization-form";
import {
  HandoffOrganizationStep,
  OrganizationDetail,
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
      screen.getByRole("link", { name: "Set up the organization" }),
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
