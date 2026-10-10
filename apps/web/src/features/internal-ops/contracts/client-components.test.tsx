import type * as UploadClient from "./upload-client";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixtureContractRecord,
  fixtureSigningRecord,
} from "../../../../../../packages/contracts/src/contract-fixture";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  saveContract: vi.fn(),
  removeContractFile: vi.fn(),
  decideContract: vi.fn(),
  operateContract: vi.fn(),
  voidContract: vi.fn(),
  prepareContract: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("./actions", () => ({
  saveContract: mocks.saveContract,
  removeContractFile: mocks.removeContractFile,
  decideContract: mocks.decideContract,
  operateContract: mocks.operateContract,
  voidContract: mocks.voidContract,
  prepareContract: mocks.prepareContract,
}));
vi.mock("./upload-client", async (original) => ({
  ...(await original<typeof UploadClient>()),
  uploadContractFile: mocks.upload,
}));
import { translatorFor } from "@/src/i18n/catalogs";
import { ContractDetail } from "./contract-detail";
import { ContractDocuments } from "./contract-documents";
import { ContractForm } from "./contract-form";
import { SigningPanel } from "./signing-panel";

const pdf = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveContract.mockResolvedValue({
    ok: true,
    value: { id: "019a44ac-0000-7000-8000-0000000000c1", version: 1 },
  });
  mocks.upload.mockResolvedValue({ ok: true, value: {} });
});

describe("record a contract", () => {
  it("saves the contract, uploads each PDF with its type and opens it", async () => {
    render(
      <ContractForm
        contract={null}
        ownerName="R.W. Holleman"
        today="2026-10-04"
      />,
    );
    fireEvent.change(screen.getByLabelText(/Counterparty legal name/), {
      target: { value: "Bluefin Data Co." },
    });
    fireEvent.change(screen.getByLabelText("Effective date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/Initial term/), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText(/Notice period/), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByLabelText("Renews automatically"));
    expect(await screen.findByText("Dec 31, 2026")).toBeInTheDocument();
    expect(screen.getByText("Nov 1, 2026")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Contract value/), {
      target: { value: "12,000.50" },
    });
    fireEvent.change(screen.getByLabelText(/Tags/), {
      target: { value: "Enterprise, EU" },
    });
    fireEvent.change(screen.getByLabelText(/Choose PDFs/), {
      target: { files: [pdf("Signed MSA.pdf"), pdf("DPA.pdf")] },
    });
    const kinds = screen.getAllByLabelText("Document type");
    expect(kinds.map((select) => (select as HTMLSelectElement).value)).toEqual([
      "main",
      "attachment",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Save contract" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/internal/contracts/019a44ac-0000-7000-8000-0000000000c1",
      ),
    );
    expect(mocks.saveContract).toHaveBeenCalledOnce();
    expect(mocks.saveContract.mock.calls[0]?.[0]).toMatchObject({
      contract: {
        counterpartyName: "Bluefin Data Co.",
        status: "executed",
        paper: "theirs",
        initialTermMonths: 12,
        autoRenew: true,
        renewalTermMonths: 12,
        noticePeriodDays: 60,
        valueMinor: 1_200_050,
        currency: "USD",
        ownerName: "R.W. Holleman",
        tags: ["Enterprise", "EU"],
      },
    });
    expect(
      (mocks.upload.mock.calls as [string, File, string][]).map((call) => [
        call[1].name,
        call[2],
      ]),
    ).toEqual([
      ["Signed MSA.pdf", "main"],
      ["DPA.pdf", "attachment"],
    ]);
  });

  it("points out fields to fix before anything is saved", async () => {
    render(<ContractForm contract={null} ownerName="" today="2026-10-04" />);
    fireEvent.change(screen.getByLabelText(/Initial term/), {
      target: { value: "twelve" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save contract" }));
    const summary = (await screen.findByText("Check these fields")).closest(
      "section",
    ) as HTMLElement;
    expect(
      within(summary).getByText(/Counterparty legal name: Required/),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(/Initial term: Enter a whole number/),
    ).toBeInTheDocument();
    expect(mocks.saveContract).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a PDF before upload", () => {
    render(<ContractForm contract={null} ownerName="x" today="2026-10-04" />);
    fireEvent.change(screen.getByLabelText(/Choose PDFs/), {
      target: {
        files: [new File(["x"], "notes.docx", { type: "application/msword" })],
      },
    });
    expect(
      screen.getByText(
        "Only PDF files can be uploaded. Save the document as a PDF and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the contract and says which uploads failed", async () => {
    mocks.upload.mockResolvedValueOnce({
      ok: false,
      code: "DOCUMENT_TOO_LARGE",
    });
    render(<ContractForm contract={null} ownerName="x" today="2026-10-04" />);
    fireEvent.change(screen.getByLabelText(/Counterparty legal name/), {
      target: { value: "Bluefin" },
    });
    fireEvent.change(screen.getByLabelText(/Choose PDFs/), {
      target: { files: [pdf("Huge.pdf")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save contract" }));
    expect(
      await screen.findByText(
        "The contract was saved, but some files did not upload",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Huge.pdf: This file is larger than 25 MB/),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("edits against the version on screen and reports a conflict", async () => {
    mocks.saveContract.mockResolvedValueOnce({
      ok: false,
      code: "CONTRACT_VERSION_CONFLICT",
    });
    render(
      <ContractForm
        contract={fixtureContractRecord}
        ownerName="x"
        today="2026-10-04"
      />,
    );
    expect(screen.queryByLabelText(/Choose PDFs/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        /Someone else changed this while you were editing/,
      ),
    ).toBeInTheDocument();
    expect(mocks.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 2 }),
    );
  });
});

describe("signing panel", () => {
  const panel = (patch: Partial<typeof fixtureSigningRecord>, props = {}) =>
    render(
      <SigningPanel
        signing={{ ...fixtureSigningRecord, ...patch }}
        generatedFileId="019a44ac-0000-7000-8000-0000000000f1"
        canWrite
        canApprove
        isPreparer={false}
        signingReady
        {...props}
      />,
    );

  it("tells the preparer that someone else must approve", () => {
    panel(
      { approvalState: "pending", approverName: null, decidedAt: null },
      { isPreparer: true },
    );
    expect(
      screen.getByText(
        "You prepared this contract, so someone else must approve it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Send for signature" }),
    ).toBeNull();
  });

  it("lets another approver approve, or send back only with a reason", async () => {
    mocks.decideContract.mockResolvedValue({ ok: true, value: {} });
    panel({ approvalState: "pending", approverName: null, decidedAt: null });
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    fireEvent.click(
      within(
        screen.getByRole("textbox").closest("form") as HTMLElement,
      ).getByRole("button", { name: "Send back" }),
    );
    expect(
      await screen.findByText(
        "Say what needs to change so the preparer can fix it.",
      ),
    ).toBeInTheDocument();
    expect(mocks.decideContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(mocks.decideContract).toHaveBeenCalledWith({
        contractId: fixtureSigningRecord.contractId,
        approve: true,
      }),
    );
  });

  it("confirms who receives the request before sending", async () => {
    mocks.operateContract.mockResolvedValue({
      ok: true,
      value: { state: "sent" },
    });
    panel({});
    fireEvent.click(screen.getByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "SignWell will email Alex Example at alex@example.com. After they sign, James Kurz signs for Fil One.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send for signature" }),
    );
    await waitFor(() =>
      expect(mocks.operateContract).toHaveBeenCalledWith({
        contractId: fixtureSigningRecord.contractId,
        operation: "send",
      }),
    );
  });

  it("says a draft SignWell is still preparing was not sent", async () => {
    mocks.operateContract.mockResolvedValue({
      ok: false,
      code: "CONTRACT_STILL_PREPARING",
    });
    panel({});
    fireEvent.click(screen.getByRole("button", { name: "Send for signature" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Send for signature",
      }),
    );
    expect(
      await screen.findByText(
        "SignWell is still preparing this contract, so it was not sent. Send it again in a minute.",
      ),
    ).toBeInTheDocument();
  });

  it("names who a reminder goes to once it is out for signature", () => {
    panel({ state: "awaiting_countersignature", providerId: "x" });
    expect(
      screen.getByRole("button", { name: "Remind James Kurz" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard draft" })).toBeNull();
  });

  it("voids a sent request only with a reason", async () => {
    mocks.voidContract.mockResolvedValue({
      ok: true,
      value: { state: "canceled" },
    });
    panel({ state: "sent", providerId: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Alex Example can no longer sign it."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Void contract" }),
    );
    expect(
      await within(dialog).findByText(
        "Enter a reason of at least 3 characters.",
      ),
    ).toBeInTheDocument();
    expect(mocks.voidContract).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Wrong legal entity" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Void contract" }),
    );
    await waitFor(() =>
      expect(mocks.voidContract).toHaveBeenCalledWith({
        contractId: fixtureSigningRecord.contractId,
        reason: "Wrong legal entity",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("offers no void once the counterparty has signed, or to a colleague without approval", () => {
    panel({ state: "awaiting_countersignature", providerId: "x" });
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
    panel(
      { state: "sent", providerId: "x" },
      { canApprove: false, isPreparer: false },
    );
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("explains a document deleted in SignWell and offers to close it", () => {
    panel({
      state: "attention",
      error: "deleted_in_signwell",
      providerId: "x",
    });
    expect(
      screen.getByText("SignWell no longer has this document"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/did not respond as expected/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Check status" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Send for signature" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
  });

  it("explains a mismatched SignWell copy and offers to void or check it again", () => {
    panel({
      state: "attention",
      error: "signwell_signers_mismatch",
      providerId: "x",
    });
    expect(
      screen.getByText(
        "The signers in SignWell no longer match this contract, so its status is not updated until they match again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/did not respond as expected/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Send for signature" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
    // The hold clears once SignWell's copy matches, so a check stays offered.
    expect(
      screen.getByRole("button", { name: "Check status" }),
    ).toBeInTheDocument();
  });

  it("explains a SignWell failure in words", async () => {
    mocks.operateContract.mockResolvedValue({
      ok: false,
      code: "SIGNWELL_HTTP_500",
    });
    panel({ state: "sent", providerId: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    expect(
      await screen.findByText(/SignWell did not respond as expected/),
    ).toBeInTheDocument();
  });
});

describe("contract documents", () => {
  const files = [
    {
      id: "019a44ac-0000-7000-8000-0000000000f1",
      kind: "main" as const,
      fileName: "Signed MSA.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 2 * 1024 * 1024,
      contentType: "application/pdf",
      uploadedByName: "R.W. Holleman",
      createdAt: "2026-10-01T15:00:00.000Z",
    },
  ];

  it("offers view and download links with the file named", () => {
    render(
      <ContractDocuments
        contractId={fixtureContractRecord.id}
        files={files}
        canWrite
        locked
        suggestedKind="main"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Download Signed MSA.pdf" }),
    ).toHaveAttribute(
      "href",
      `/internal/contracts/${fixtureContractRecord.id}/files/${files[0]?.id}`,
    );
    expect(
      screen.queryByRole("button", { name: "Remove Signed MSA.pdf" }),
    ).toBeNull();
    expect(screen.getByText(/kept permanently/)).toBeInTheDocument();
  });

  it("asks before removing a document and reports a refusal", async () => {
    mocks.removeContractFile.mockResolvedValue({
      ok: false,
      code: "CONTRACT_FILE_PERMANENT",
    });
    render(
      <ContractDocuments
        contractId={fixtureContractRecord.id}
        files={files}
        canWrite
        locked={false}
        suggestedKind="main"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Signed MSA.pdf" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(
      await screen.findByText(
        /Documents on an executed contract cannot be removed/,
      ),
    ).toBeInTheDocument();
  });

  it("explains an empty document list to readers", () => {
    render(
      <ContractDocuments
        contractId={fixtureContractRecord.id}
        files={[]}
        canWrite={false}
        locked={false}
        suggestedKind="main"
      />,
    );
    expect(screen.getByText("No documents yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });
});

describe("contract history", () => {
  const event = (eventType: string, changes: Record<string, unknown> = {}) => ({
    id: `${eventType}-id`,
    eventType,
    actorName: "R.W. Holleman",
    changes,
    occurredAt: "2026-10-09T12:00:00.000Z",
  });

  it("names voids, reminders and SignWell findings in words, with the void reason", () => {
    render(
      <ContractDetail
        t={translatorFor("en")}
        locale="en-US"
        contract={fixtureContractRecord}
        files={[]}
        activity={[
          event("contract.voided", {
            status: { from: "out_for_signature", to: "draft" },
            reason: "Wrong legal entity",
          }),
          event("contract.reminded", { recipient: "fil-one" }),
          event("contract.reminded", { recipient: "counterparty" }),
          event("contract.deleted_in_signwell"),
          event("contract.signwell_mismatch", {
            reason: "signwell_signers_mismatch",
          }),
        ]}
        signing={null}
        today="2026-10-09"
        canWrite
        canApprove={false}
        isPreparer={false}
        signingReady
      />,
    );
    const history = screen.getByRole("region", { name: "Activity" });
    for (const text of [
      "Voided",
      "Reason: Wrong legal entity",
      "Reminder sent to the Fil One countersigner",
      "Reminder sent to the counterparty signer",
      "Found deleted in SignWell",
      "SignWell's copy stopped matching this contract",
    ])
      expect(within(history).getByText(text)).toBeInTheDocument();
    expect(within(history).queryByText(/^contract\./)).toBeNull();
  });
});
