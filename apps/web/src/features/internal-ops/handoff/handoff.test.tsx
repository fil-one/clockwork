import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HandoffRequestRecord } from "@clockwork/contracts";
import type { HandoffContractContext } from "@clockwork/db";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  decide: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  requestHandoff: mocks.request,
  decideHandoff: mocks.decide,
}));
vi.mock("./server", () => ({ loadContractHandoff: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { ContractHandoffSection } from "./contract-handoff";
import { HandoffDecision } from "./handoff-decision";
import { HandoffDetailView } from "./handoff-detail";
import { HandoffQueue } from "./handoff-queue";

const contractId = "019a44ac-0000-7000-8000-0000000000c1";
const record = (
  patch: Partial<HandoffRequestRecord> = {},
): HandoffRequestRecord => ({
  id: "019a44ac-0000-7000-8000-0000000000e1",
  requestedById: "019a44ac-0000-7000-8000-0000000000aa",
  requestedByName: "Pat Seller",
  counterpartyLegalName: "Bluefin Data Co.",
  signerName: "Alex Example",
  signerEmail: "alex@example.com",
  signerTitle: "CEO",
  contractIds: [contractId],
  mndaId: null,
  pricingScenarioId: null,
  requestedSide: "customer",
  notes: "",
  status: "open",
  assigneeId: null,
  assigneeName: null,
  decisionNote: null,
  decidedAt: null,
  organizationId: null,
  createdAt: "2026-10-09T12:00:00.000Z",
  updatedAt: "2026-10-09T12:00:00.000Z",
  version: 1,
  ...patch,
});
const context = (
  patch: Partial<HandoffContractContext> = {},
): HandoffContractContext => ({
  contract: {
    id: contractId,
    counterpartyName: "Bluefin Data Co.",
    title: "Master services agreement",
    status: "executed",
    signed: true,
    signedVia: "recorded",
  },
  signer: { name: "Alex Example", email: "alex@example.com", title: "CEO" },
  mndas: [
    {
      id: "019a44ac-0000-7000-8000-0000000000d1",
      company: "Bluefin Data Co.",
      signerName: "Alex Example",
      completedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  scenarios: [],
  requests: [],
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the contract record's handoff section", () => {
  it("prefills the request from the contract and sends it", async () => {
    mocks.request.mockResolvedValue({
      ok: true,
      value: { id: "x", version: 1 },
    });
    render(
      await ContractHandoffSection({
        loaded: { kind: "ready", value: context() },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hand to operations" }));
    expect(screen.getByLabelText(/Counterparty legal name/u)).toHaveValue(
      "Bluefin Data Co.",
    );
    expect(screen.getByLabelText(/Signer email/u)).toHaveValue(
      "alex@example.com",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to operations" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({
      contractIds: [contractId],
      counterpartyLegalName: "Bluefin Data Co.",
      signerName: "Alex Example",
      requestedSide: "customer",
      mndaId: "019a44ac-0000-7000-8000-0000000000d1",
      pricingScenarioId: null,
    });
    expect(
      await screen.findAllByText(
        "Sent to operations. Its status shows here and on your home page.",
      ),
    ).not.toHaveLength(0);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("words a refusal from the server", async () => {
    mocks.request.mockResolvedValue({
      ok: false,
      code: "HANDOFF_ALREADY_REQUESTED",
    });
    render(
      await ContractHandoffSection({
        loaded: { kind: "ready", value: context() },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hand to operations" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to operations" }));
    expect(
      await screen.findByText("This contract is already with operations."),
    ).toBeInTheDocument();
  });

  it("shows the live request and offers no second one", async () => {
    render(
      await ContractHandoffSection({
        loaded: {
          kind: "ready",
          value: context({
            requests: [
              record({ status: "in_progress", assigneeName: "Ops Person" }),
            ],
          }),
        },
      }),
    );
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText(/Ops Person/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hand to operations" }),
    ).not.toBeInTheDocument();
  });

  it("explains that only an executed contract can be handed off", async () => {
    render(
      await ContractHandoffSection({
        loaded: {
          kind: "ready",
          value: context({
            contract: { ...context().contract, signed: false },
          }),
        },
      }),
    );
    expect(
      screen.getByText(
        "A contract can be handed to operations once it is executed.",
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing for a reader who may not raise one", async () => {
    expect(
      await ContractHandoffSection({ loaded: { kind: "forbidden" } }),
    ).toBeNull();
  });
});

describe("the handoff detail", () => {
  it("says how each contract came to be signed", async () => {
    render(
      await HandoffDetailView({
        request: {
          ...record({ contractIds: [contractId, "c2"] }),
          contracts: [
            {
              id: contractId,
              counterpartyName: "Bluefin Data Co.",
              title: "Master services agreement",
              status: "executed",
              signed: true,
              signedVia: "commerce",
            },
            {
              id: "c2",
              counterpartyName: "Bluefin Data Co.",
              title: "Order form",
              status: "executed",
              signed: true,
              signedVia: "recorded",
            },
          ],
          mnda: null,
          pricingScenario: null,
        },
        canWork: false,
        readerId: "reader",
      }),
    );
    expect(
      screen.getByText(/Executed\s*, signed in Commerce/u),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Executed\s*, recorded as executed by staff/u),
    ).toBeInTheDocument();
  });
});

describe("the operations queue", () => {
  it("lists requests with their status and links each one", async () => {
    render(
      await HandoffQueue({
        requests: [
          record(),
          record({
            id: "019a44ac-0000-7000-8000-0000000000e2",
            status: "declined",
            counterpartyLegalName: "Globex",
          }),
        ],
        status: undefined,
      }),
    );
    expect(
      screen.getByRole("link", { name: "Bluefin Data Co." }),
    ).toHaveAttribute(
      "href",
      "/internal/handoffs/019a44ac-0000-7000-8000-0000000000e1",
    );
    expect(screen.getAllByText("Waiting for operations")).not.toHaveLength(0);
    expect(screen.getAllByText("Declined")).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("says when nothing is waiting", async () => {
    render(await HandoffQueue({ requests: [], status: "open" }));
    expect(screen.getByText("Nothing waiting")).toBeInTheDocument();
  });
});

describe("the operations decision", () => {
  it("takes an open request at the version it was read", async () => {
    mocks.decide.mockResolvedValue({ ok: true, value: {} });
    render(
      <HandoffDecision
        id="019a44ac-0000-7000-8000-0000000000e1"
        version={3}
        status="open"
        assignedToReader={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Mark done" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take" }));
    await waitFor(() =>
      expect(mocks.decide).toHaveBeenCalledWith("take", {
        id: "019a44ac-0000-7000-8000-0000000000e1",
        expectedVersion: 3,
      }),
    );
  });

  it("declines with the note and words a refusal", async () => {
    mocks.decide.mockResolvedValue({
      ok: false,
      code: "HANDOFF_DECLINE_NOTE_REQUIRED",
    });
    render(
      <HandoffDecision
        id="019a44ac-0000-7000-8000-0000000000e1"
        version={2}
        status="in_progress"
        assignedToReader
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(
      await screen.findByText("Add a note for the seller before declining."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Note for the seller/u), {
      target: { value: "Wrong entity" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(mocks.decide).toHaveBeenLastCalledWith("decline", {
        id: "019a44ac-0000-7000-8000-0000000000e1",
        expectedVersion: 2,
        note: "Wrong entity",
      }),
    );
  });

  it("offers nothing on a closed request", () => {
    const { container } = render(
      <HandoffDecision id="x" version={4} status="done" assignedToReader />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
