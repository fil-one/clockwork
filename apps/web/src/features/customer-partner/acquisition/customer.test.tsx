import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import {
  effectiveCustomerOffers,
  type CustomerAcquisitionView,
  type CustomerAcquisitionRequest,
} from "@clockwork/domain/core";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./actions", () => ({ submitCustomerAcquisition: mocks.submit }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
import { currentDemoPaygPolicies } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { CustomerAcquisition } from "./customer";
const now = "2026-09-06T12:00:00.000Z";
const view: CustomerAcquisitionView = {
  offers: effectiveCustomerOffers(
    currentDemoPaygPolicies(createPristineDemoAdapterState(), now),
    now,
  ),
  organizations: [
    {
      id: "31000000-0000-4000-8000-000000000001",
      name: "Example organization",
      canRequest: true,
      providerMapped: false,
    },
  ],
  requests: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.submit.mockResolvedValue({
    ok: false,
    message: "The offer changed.",
    code: "ACQUISITION_OFFER_CHANGED",
  });
});
it("clears assent when the displayed offer fingerprint changes", async () => {
  const user = userEvent.setup();
  const props = {
    view,
    accountId: "11000000-0000-4000-8000-000000000001",
    demo: true,
    available: true,
  };
  const { rerender } = render(<CustomerAcquisition {...props} />);
  const consent = screen.getByRole("checkbox", {
    name: /I have read and agree/,
  });
  await user.click(consent);
  expect(consent).toBeChecked();
  rerender(
    <CustomerAcquisition
      {...props}
      view={{
        ...view,
        offers: view.offers.map((offer) => ({
          ...offer,
          rowVersion: offer.rowVersion + 1,
          fingerprint: "f".repeat(64),
        })),
      }}
    />,
  );
  expect(consent).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Accept terms and request PAYG" }),
  ).toBeDisabled();
});
it("provides a safe refresh after stale acceptance and never keeps the checkbox selected", async () => {
  const user = userEvent.setup();
  render(
    <CustomerAcquisition
      view={view}
      accountId="11000000-0000-4000-8000-000000000001"
      demo
      available
    />,
  );
  await user.click(
    screen.getByRole("checkbox", { name: /I have read and agree/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Accept terms and request PAYG" }),
  );
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("checkbox", { name: /I have read and agree/ }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Refresh offers" }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "Accept terms and request PAYG" }),
  ).toBeDisabled();
});

it("exits a successful conversion review while retaining its pending receipt and allowing another organization", async () => {
  const user = userEvent.setup();
  mocks.submit.mockResolvedValue({
    ok: true,
    message: "Conversion request retained.",
  });
  const organization = view.organizations[0];
  const offer = view.offers[0];
  if (!organization || !offer)
    throw new Error("Acquisition fixture is missing its offer or organization");
  const trial: CustomerAcquisitionRequest = {
    id: "request-trial",
    accountId: "account",
    organizationId: organization.id,
    organizationName: organization.name,
    kind: "trial",
    status: "fulfilled",
    rowVersion: 2,
    acceptedAt: now,
    offer,
    reason: "",
    resolutionReason: null,
    trialId: "trial-source",
    enrollmentId: null,
    result: {
      kind: "trial",
      id: "trial-source",
      startsAt: now,
      endsAt: "2026-09-20T12:00:00.000Z",
      convertedAt: null,
      billingAuthority: null,
    },
  };
  const initialView: CustomerAcquisitionView = {
    ...view,
    organizations: [
      ...view.organizations,
      {
        id: "other-org",
        name: "Other organization",
        canRequest: true,
        providerMapped: false,
      },
    ],
    requests: [trial],
  };
  const props = {
    view: initialView,
    accountId: "account",
    demo: true,
    available: true,
  };
  const { rerender } = render(<CustomerAcquisition {...props} />);
  await user.click(
    screen.getByRole("button", { name: "Review PAYG conversion" }),
  );
  expect(screen.getByRole("combobox", { name: "Organization" })).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", { name: /I have read and agree/ }),
  );
  await user.click(
    screen.getByRole("button", {
      name: "Accept paid terms and request conversion",
    }),
  );
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "convert_to_payg",
      trialId: "trial-source",
    }),
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("heading", { name: "Choose your offer" }),
  ).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: /I have read and agree/ }),
  ).not.toBeChecked();
  rerender(
    <CustomerAcquisition
      {...props}
      view={{
        ...initialView,
        requests: [
          trial,
          {
            ...trial,
            id: "request-conversion",
            kind: "convert_to_payg",
            status: "pending",
            rowVersion: 1,
            result: null,
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByText("Pending verified handoff", { exact: true }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Accept terms and request PAYG" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Review PAYG conversion" }),
  ).toBeDisabled();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Organization" }),
    "other-org",
  );
  await user.click(
    screen.getByRole("checkbox", { name: /I have read and agree/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Accept terms and request PAYG" }),
  );
  expect(mocks.submit).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "payg", organizationId: "other-org" }),
  );
  expect(mocks.submit.mock.calls.at(-1)?.[0]).not.toHaveProperty("trialId");
  expect(
    screen.getByText("Pending verified handoff", { exact: true }),
  ).toBeVisible();
});
