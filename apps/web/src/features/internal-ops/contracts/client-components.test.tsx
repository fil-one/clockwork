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
  correctContractSigner: vi.fn(),
  prepareContract: vi.fn(),
  findContractDuplicates: vi.fn(),
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
  correctContractSigner: mocks.correctContractSigner,
  prepareContract: mocks.prepareContract,
  findContractDuplicates: mocks.findContractDuplicates,
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
  mocks.findContractDuplicates.mockResolvedValue({
    ok: true,
    value: { mndas: [], contracts: [] },
  });
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

  it("starts from a signed MNDA with its counterparty filled in", async () => {
    const mnda = {
      id: "019a44ac-0000-7000-8000-0000000000e1",
      company: "Northwind Analytics Ltd",
      signerName: "Alex Example",
      signedOn: "2026-09-28",
    };
    render(
      <ContractForm
        contract={null}
        ownerName="x"
        today="2026-10-04"
        fromMnda={mnda}
      />,
    );
    expect(screen.getByLabelText(/Counterparty legal name/)).toHaveValue(
      "Northwind Analytics Ltd",
    );
    expect(
      screen.getByText(
        "From the MNDA signed on Sep 28, 2026. Counterparty signer: Alex Example.",
      ),
    ).toBeInTheDocument();
    // The MNDA it starts from is not reported as a duplicate of itself.
    await waitFor(
      () =>
        expect(mocks.findContractDuplicates).toHaveBeenCalledWith({
          counterpartyName: "Northwind Analytics Ltd",
          excludeMndaId: mnda.id,
        }),
      { timeout: 2000 },
    );
  });

  it("warns about earlier papers for the same counterparty and still saves", async () => {
    mocks.findContractDuplicates.mockResolvedValue({
      ok: true,
      value: {
        mndas: [
          {
            id: "019a44ac-0000-7000-8000-0000000000e1",
            company: "Bluefin Data Co.",
            state: "completed",
            createdAt: "2026-09-01T00:00:00Z",
            completedAt: "2026-09-02T00:00:00Z",
            ownerName: "R.W. Holleman",
          },
        ],
        contracts: [
          {
            id: "019a44ac-0000-7000-8000-0000000000c7",
            counterpartyName: "BLUEFIN DATA, Inc.",
            contractType: "order_form",
            status: "executed",
            effectiveDate: "2026-03-01",
            ownerName: "Morgan Lee",
          },
        ],
      },
    });
    render(<ContractForm contract={null} ownerName="x" today="2026-10-04" />);
    fireEvent.change(screen.getByLabelText(/Counterparty legal name/), {
      target: { value: "Bluefin Data Co" },
    });
    expect(
      await screen.findByText(
        "Fil One already has an MNDA with this company",
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The contract register already lists this company"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "BLUEFIN DATA, Inc." }),
    ).toHaveAttribute(
      "href",
      "/internal/contracts/019a44ac-0000-7000-8000-0000000000c7",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save contract" }));
    await waitFor(() => expect(mocks.saveContract).toHaveBeenCalledOnce());
    expect(mocks.findContractDuplicates).toHaveBeenCalledWith({
      counterpartyName: "Bluefin Data Co",
    });
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
    // Editing a recorded contract does not look for duplicates of itself.
    expect(mocks.findContractDuplicates).not.toHaveBeenCalled();
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

  it("asks a preparer holding approval:self for a reason to approve their own contract", async () => {
    mocks.decideContract.mockResolvedValue({ ok: true, value: {} });
    const pending = {
      approvalState: "pending" as const,
      approverName: null,
      decidedAt: null,
    };
    const { unmount } = panel(pending, { isPreparer: true });
    expect(
      screen.queryByRole("button", { name: "Approve my own request" }),
    ).toBeNull();
    unmount();
    panel(pending, { isPreparer: true, canSelfApprove: true });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve my own request" }),
    );
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Approve my own request",
    });
    fireEvent.click(confirm);
    expect(
      await within(dialog).findByText("Write a reason of 8 to 500 characters."),
    ).toBeInTheDocument();
    expect(mocks.decideContract).not.toHaveBeenCalled();
    fireEvent.change(
      within(dialog).getByLabelText(/Why are you approving it yourself/),
      { target: { value: "Two-person team, colleague travelling" } },
    );
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.decideContract).toHaveBeenCalledWith({
        contractId: fixtureSigningRecord.contractId,
        approve: true,
        selfApprovalReason: "Two-person team, colleague travelling",
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
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
    // The draft is bound and stored as preparing, so the panel reloads.
    expect(mocks.refresh).toHaveBeenCalledOnce();
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

  it("holds a copy someone signed in SignWell for an administrator, offering no send or void", () => {
    panel({
      state: "attention",
      error: "signwell_signed_mismatch",
      providerId: "x",
    });
    expect(
      screen.getByText(
        "Someone signed this contract in SignWell, but SignWell's copy does not match it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ask a commerce administrator to resolve it in SignWell.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send for signature" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Check status" }),
    ).toBeInTheDocument();
  });

  it("reloads the panel when a reminder is refused after SignWell's new state was stored", async () => {
    mocks.operateContract.mockResolvedValue({
      ok: false,
      code: "CONTRACT_NOT_PENDING",
    });
    panel({ state: "sent", providerId: "x" });
    fireEvent.click(
      screen.getByRole("button", { name: "Remind Alex Example" }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });

  it("fixes a bounced counterparty email in place, without sending the reader to SignWell", async () => {
    mocks.correctContractSigner.mockResolvedValue({
      ok: true,
      value: { state: "sent", signerEmail: "right@example.com" },
    });
    panel({ state: "attention", error: "recipient_bounced", providerId: "x" });
    expect(screen.getByText("A signer's email bounced")).toBeInTheDocument();
    expect(screen.queryByText(/Check the document in SignWell/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fix email" }));
    const dialog = await screen.findByRole("dialog");
    const email = within(dialog).getByLabelText(/Signer's email/);
    expect(email).toHaveValue("alex@example.com");
    fireEvent.change(email, { target: { value: " right@example.com " } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to new email" }),
    );
    await waitFor(() =>
      expect(mocks.correctContractSigner).toHaveBeenCalledWith({
        contractId: fixtureSigningRecord.contractId,
        signerEmail: "right@example.com",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("says when the counterparty has started signing and stops offering the fix", async () => {
    mocks.correctContractSigner.mockResolvedValue({
      ok: false,
      code: "CONTRACT_SIGNER_STARTED",
    });
    panel({ state: "viewed", providerId: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Fix email" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Signer's email/), {
      target: { value: "right@example.com" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to new email" }),
    );
    expect(
      await within(dialog).findByText(/has started signing/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Send to new email" }),
    ).toBeDisabled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("offers no fix once the counterparty has signed, or to a colleague without approval", () => {
    panel({ state: "awaiting_countersignature", providerId: "x" });
    expect(screen.queryByRole("button", { name: "Fix email" })).toBeNull();
    panel(
      { state: "sent", providerId: "x" },
      { canApprove: false, isPreparer: false },
    );
    expect(screen.queryByRole("button", { name: "Fix email" })).toBeNull();
  });

  it("voids for someone else without a reason and opens the template with the earlier values", async () => {
    mocks.voidContract.mockResolvedValue({
      ok: true,
      value: { state: "canceled" },
    });
    panel({ state: "sent", providerId: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Fix email" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Someone else will sign",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Void this contract?",
    });
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(
      within(dialog).getByText(/the template opens with the same values/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Void contract" }),
    );
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        `/internal/contracts/templates/${fixtureSigningRecord.templateId}?from=${fixtureSigningRecord.contractId}`,
      ),
    );
    expect(mocks.voidContract).toHaveBeenCalledWith({
      contractId: fixtureSigningRecord.contractId,
      code: "signer_change",
    });
  });

  it("links a request voided for someone else to a new preparation", () => {
    panel({ state: "canceled", providerId: "x", cancelCode: "signer_change" });
    expect(
      screen.getByText("Voided: someone else will sign"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prepare again" })).toHaveAttribute(
      "href",
      `/internal/contracts/templates/${fixtureSigningRecord.templateId}?from=${fixtureSigningRecord.contractId}`,
    );
  });

  it("explains a SignWell failure in words, without reloading", async () => {
    mocks.operateContract.mockResolvedValue({
      ok: false,
      code: "SIGNWELL_HTTP_500",
    });
    panel({ state: "sent", providerId: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    expect(
      await screen.findByText(/SignWell did not respond as expected/),
    ).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
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
          event("contract.voided", { cancelCode: "signer_change" }),
          event("contract.signer_correction_requested", {
            before: { signerEmail: "alex@example.com" },
            signerEmail: "right@example.com",
          }),
          event("contract.signer_corrected", {
            before: { signerEmail: "alex@example.com" },
            signerEmail: "right@example.com",
          }),
          event("contract.signer_correction_dropped"),
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
      "Voided: someone else will sign",
      "Counterparty email change sent to SignWell: right@example.com",
      "Counterparty email changed to right@example.com",
      "Counterparty email change not applied by SignWell",
    ])
      expect(within(history).getByText(text)).toBeInTheDocument();
    expect(within(history).queryByText(/^contract\./)).toBeNull();
  });
});
