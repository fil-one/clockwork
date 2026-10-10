import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { MndaRecord, MndaRegisterQuery } from "@clockwork/contracts";
import {
  fixtureInput,
  fixtureRecord,
  fixtureSigner,
} from "../../../../../../packages/contracts/src/mnda-fixture";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  operate: vi.fn(),
  load: vi.fn(),
  loadRegister: vi.fn(),
  duplicates: vi.fn(),
  void: vi.fn(),
  correct: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  prepareMnda: mocks.prepare,
  operateMnda: mocks.operate,
  loadMndas: mocks.load,
  loadMndaRegister: mocks.loadRegister,
  findMndaDuplicates: mocks.duplicates,
  voidMnda: mocks.void,
  correctMndaSigner: mocks.correct,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
import { MndaWorkspace } from "./workspace";

const query: MndaRegisterQuery = {
  status: [],
  mine: false,
  q: "",
  page: 1,
  pageSize: 25,
};
const data = (records: MndaRecord[] = []) => ({
  register: { records, total: records.length, page: 1, pageSize: 25 },
  signers: [fixtureSigner],
  noticeEmail: "legal@fil.one",
  ready: true,
  testMode: false,
  canManage: false,
  viewerId: fixtureRecord.ownerId,
});
const sent: MndaRecord = {
  ...fixtureRecord,
  state: "sent",
  providerId: "019a44ac-0000-7000-8000-000000000005",
  sentAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};
function fill(values: Partial<Record<string, string>>) {
  for (const [name, value] of Object.entries(values))
    fireEvent.change(
      document.querySelector(`input[name="${name}"]`) as HTMLInputElement,
      { target: { value } },
    );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ ok: true, value: data() });
  mocks.loadRegister.mockResolvedValue({
    ok: true,
    value: { register: data().register },
  });
  mocks.duplicates.mockResolvedValue({
    ok: true,
    value: { mndas: [], contracts: [] },
  });
  mocks.prepare.mockResolvedValue({ ok: true, value: fixtureRecord });
  mocks.operate.mockResolvedValue({
    ok: true,
    value: { ...fixtureRecord, state: "sent" },
  });
});

it("previews before sending, then edits the same details into a replacement draft", async () => {
  render(<MndaWorkspace initial={data()} initialQuery={query} />);
  fireEvent.click(screen.getByRole("button", { name: "New MNDA" }));
  fill({
    signerName: fixtureInput.signerName,
    signerEmail: fixtureInput.signerEmail,
    company: fixtureInput.company,
  });
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  await screen.findByRole("heading", { name: "Review before sending" });
  expect(mocks.operate).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Open PDF" })).toHaveAttribute(
    "href",
    `/internal/mndas/${fixtureRecord.id}/pdf?kind=original`,
  );
  expect(screen.getByText("notices@example.com")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
  expect(screen.getByLabelText(/Counterparty legal name/)).toHaveValue(
    fixtureInput.company,
  );
  fill({ company: "Example Holdings LLC" });
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
  const second = mocks.prepare.mock.calls[1]?.[0] as {
    input: { id: string; company: string };
    supersedes: string[];
  };
  expect(second.supersedes).toEqual([fixtureRecord.id]);
  expect(second.input.company).toBe("Example Holdings LLC");
  expect(second.input.id).not.toBe(fixtureRecord.id);
  await screen.findByRole("heading", { name: "Review before sending" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
  await waitFor(() =>
    expect(mocks.operate).toHaveBeenCalledExactlyOnceWith({
      id: fixtureRecord.id,
      operation: "send",
    }),
  );
  expect(await screen.findByText(/Sent to alex@example.com/)).toBeVisible();
});

it("shows specific messages next to each field and focuses the first problem", async () => {
  render(<MndaWorkspace initial={data()} initialQuery={query} />);
  fireEvent.click(screen.getByRole("button", { name: "New MNDA" }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByLabelText(/Counterparty signer name/),
    ),
  );
  expect(screen.getAllByText("Enter this detail.")).toHaveLength(3);
  expect(mocks.prepare).not.toHaveBeenCalled();
  mocks.prepare.mockResolvedValueOnce({
    ok: false,
    code: "invalid_characters",
    fields: [{ field: "company", code: "invalid_characters" }],
  });
  fill({
    signerName: "Alex",
    signerEmail: "alex@example.com",
    company: "Acme {internal}",
  });
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  const company = screen.getByLabelText(/Counterparty legal name/);
  await waitFor(() => expect(document.activeElement).toBe(company));
  expect(company).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText(/Remove angle brackets/)).toBeVisible();
  fill({ signerEmail: fixtureSigner.email, company: "Acme" });
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  expect(
    await screen.findByText(
      "The partner signer can't use the Fil One countersigner's email.",
    ),
  ).toBeVisible();
});

it("warns before papering a company that already has an MNDA or a register contract", async () => {
  mocks.duplicates.mockResolvedValue({
    ok: true,
    value: {
      mndas: [
        {
          id: sent.id,
          company: "Example Corporation",
          state: "completed",
          createdAt: "2026-09-28T00:00:00Z",
          completedAt: "2026-09-28T00:00:00Z",
          ownerName: "R.W. Holleman",
        },
      ],
      contracts: [
        {
          id: "019a44ac-0000-7000-8000-0000000000c1",
          counterpartyName: "EXAMPLE, Inc.",
          contractType: "nda_one_way",
          status: "executed",
          effectiveDate: "2025-04-01",
          ownerName: "Morgan Lee",
        },
      ],
    },
  });
  render(<MndaWorkspace initial={data()} initialQuery={query} />);
  fireEvent.click(screen.getByRole("button", { name: "New MNDA" }));
  fill({ company: "Example Corp." });
  expect(
    await screen.findByText(
      "Fil One already has an MNDA with this company",
      {},
      { timeout: 2000 },
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Example Corporation" }),
  ).toHaveAttribute("href", "/internal/mndas?q=Example%20Corporation");
  expect(screen.getByText(/Signed, .*R\.W\. Holleman/)).toBeVisible();
  expect(
    screen.getByText("The contract register already lists this company"),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "EXAMPLE, Inc." })).toHaveAttribute(
    "href",
    "/internal/contracts/019a44ac-0000-7000-8000-0000000000c1",
  );
  expect(
    screen.getByText(/, Executed, effective Apr 1, 2025, owner Morgan Lee/),
  ).toBeVisible();
});

it("explains a SignWell copy that no longer matches, and sends a signed one to an administrator", () => {
  const signed = {
    ...sent,
    id: "019a44ac-0000-7000-8000-0000000000dd",
    state: "attention" as const,
    error: "signwell_signed_mismatch",
    input: { ...sent.input, company: "Signed Elsewhere Co" },
  };
  render(
    <MndaWorkspace
      initial={data([
        { ...sent, state: "attention", error: "signwell_signers_mismatch" },
        signed,
      ])}
      initialQuery={query}
    />,
  );
  const row = (company: string) =>
    within(screen.getByText(company).closest("tr") as HTMLElement);
  expect(
    row("Example Corporation").getByText(
      /The signers in SignWell no longer match this MNDA/,
    ),
  ).toBeVisible();
  expect(
    row("Example Corporation").getByText(/void it, then send it again\./),
  ).toBeVisible();
  expect(
    row("Example Corporation").getByRole("button", { name: "Void" }),
  ).toBeVisible();
  expect(
    row("Example Corporation").getByRole("button", { name: "Fix email" }),
  ).toBeVisible();
  expect(
    row("Signed Elsewhere Co").getByText(
      /Ask a commerce administrator to resolve it in SignWell\./,
    ),
  ).toBeVisible();
  expect(
    row("Signed Elsewhere Co").queryByRole("button", { name: "Void" }),
  ).toBeNull();
  expect(
    row("Signed Elsewhere Co").queryByRole("button", { name: "Fix email" }),
  ).toBeNull();
});

it("no longer offers the partner-completes mode, and copies an old one into the default mode", async () => {
  const legacy: MndaRecord = {
    ...sent,
    state: "completed",
    input: {
      ...fixtureInput,
      detailsMode: "recipient",
      company: "Deal 42 reference",
      shortName: "",
      entityDescription: "",
      streetAddress: "",
      locality: "",
      noticesContact: "",
      noticesEmail: "",
      signerTitle: "",
    },
  };
  render(<MndaWorkspace initial={data([legacy])} initialQuery={query} />);
  expect(screen.getByText("Deal 42 reference")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Send again" }));
  expect(await screen.findByLabelText(/Counterparty legal name/)).toHaveValue(
    "",
  );
  expect(screen.getByLabelText(/Counterparty signer name/)).toHaveValue(
    fixtureInput.signerName,
  );
  expect(
    screen.getAllByRole("radio").map((r) => r.getAttribute("value")),
  ).toEqual(["mixed", "team"]);
  expect(screen.getByRole("radio", { checked: true })).toHaveAttribute(
    "value",
    "mixed",
  );
});

it("refreshes only the register while the page is open", async () => {
  vi.useFakeTimers();
  try {
    const refreshed = { ...sent, state: "viewed" as const };
    mocks.loadRegister.mockResolvedValue({
      ok: true,
      value: {
        register: { records: [refreshed], total: 1, page: 1, pageSize: 25 },
      },
    });
    render(<MndaWorkspace initial={data([sent])} initialQuery={query} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(mocks.loadRegister).toHaveBeenCalledWith(query);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.getByText("Opened by partner")).toBeVisible();
    expect(screen.getByRole("button", { name: "New MNDA" })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it("explains blocked requests in plain words with the next step", () => {
  render(
    <MndaWorkspace
      initial={data([
        { ...sent, state: "attention", error: "recipient_bounced" },
        {
          ...sent,
          id: fixtureInput.countersignerId,
          state: "awaiting_countersignature",
        },
      ])}
      initialQuery={query}
    />,
  );
  expect(screen.getByText(/The partner's email bounced\./)).toBeVisible();
  expect(
    screen.getByText(/Fix the email and SignWell sends it again\./),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Fix email" })).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Remind James Kurz" }),
  ).toBeVisible();
  expect(screen.getAllByText("3 days")).toHaveLength(2);
});

it("filters by status and owner through the URL", async () => {
  const replace = vi.spyOn(window.history, "replaceState");
  render(<MndaWorkspace initial={data([sent])} initialQuery={query} />);
  fireEvent.click(screen.getByRole("button", { name: "Waiting on partner" }));
  await waitFor(() =>
    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({ status: ["sent", "viewed"], page: 1 }),
    ),
  );
  expect(replace).toHaveBeenLastCalledWith(
    null,
    "",
    expect.stringContaining("?status=sent%2Cviewed"),
  );
  expect(
    screen.getByRole("button", { name: "Waiting on partner" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: "Only mine" }));
  await waitFor(() =>
    expect(mocks.load).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: ["sent", "viewed"], mine: true }),
    ),
  );
  expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/internal/mndas/export?status=sent%2Cviewed&mine=1",
  );
});

it("voids a sent MNDA only after a reason is given", async () => {
  mocks.void.mockResolvedValue({
    ok: true,
    value: { ...sent, state: "canceled", cancelReason: "Wrong entity" },
  });
  render(<MndaWorkspace initial={data([sent])} initialQuery={query} />);
  fireEvent.click(screen.getByRole("button", { name: "Void" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Void this MNDA?",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Void MNDA" }));
  expect(
    await within(dialog).findByText("Enter a reason of at least 3 characters."),
  ).toBeVisible();
  expect(mocks.void).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText(/Reason/), {
    target: { value: "Wrong entity" },
  });
  act(() => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Void MNDA" }));
  });
  expect(mocks.void).toHaveBeenCalledWith({
    id: sent.id,
    reason: "Wrong entity",
  });
  expect(
    await screen.findByText("MNDA voided. The partner can no longer sign it."),
  ).toBeVisible();
});

it("keeps sending disabled when the provider is not configured", async () => {
  render(
    <MndaWorkspace
      initial={{ ...data([fixtureRecord]), ready: false }}
      initialQuery={query}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    await screen.findByRole("button", { name: "Confirm and send" }),
  ).toBeDisabled();
});

it("offers void and email fixes only to the preparer, and never after the partner signed", () => {
  const colleague = {
    ...sent,
    id: "019a44ac-0000-7000-8000-0000000000aa",
    ownerId: "019a44ac-0000-7000-8000-0000000000bb",
    input: { ...sent.input, company: "Colleague Co" },
  };
  const signed = {
    ...sent,
    id: "019a44ac-0000-7000-8000-0000000000cc",
    state: "awaiting_countersignature" as const,
    input: { ...sent.input, company: "Signed Co" },
  };
  render(
    <MndaWorkspace
      initial={data([sent, colleague, signed])}
      initialQuery={query}
    />,
  );
  const row = (company: string) =>
    within(screen.getByText(company).closest("tr") as HTMLElement);
  expect(
    row("Example Corporation").getByRole("button", { name: "Void" }),
  ).toBeVisible();
  expect(
    row("Colleague Co").queryByRole("button", { name: "Void" }),
  ).toBeNull();
  expect(
    row("Colleague Co").queryByRole("button", { name: "Fix email" }),
  ).toBeNull();
  expect(
    row("Colleague Co").getByRole("button", { name: /^Remind/ }),
  ).toBeVisible();
  expect(row("Signed Co").queryByRole("button", { name: "Void" })).toBeNull();
});

it("refreshes an expired session through a navigation and retries the poll once", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mocks.loadRegister
      .mockResolvedValueOnce({ ok: false, code: "session_expired" })
      .mockResolvedValueOnce({
        ok: true,
        value: { register: data([sent]).register },
      });
    render(<MndaWorkspace initial={data()} initialQuery={query} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(await screen.findByText("Example Corporation")).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.loadRegister).toHaveBeenCalledTimes(2);
    expect(mocks.load).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("asks to reload an expired session and keeps what was typed", async () => {
  mocks.prepare.mockResolvedValueOnce({ ok: false, code: "session_expired" });
  render(<MndaWorkspace initial={data()} initialQuery={query} />);
  fireEvent.click(screen.getByRole("button", { name: "New MNDA" }));
  fill({
    signerName: fixtureInput.signerName,
    signerEmail: fixtureInput.signerEmail,
    company: fixtureInput.company,
  });
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  expect(
    await screen.findByText("Your session expired. Reload to continue."),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Your session expired. Reload to continue."),
    ).toBeNull(),
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(screen.getByLabelText(/Counterparty legal name/)).toHaveValue(
    fixtureInput.company,
  );
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  await screen.findByRole("heading", { name: "Review before sending" });
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
});
