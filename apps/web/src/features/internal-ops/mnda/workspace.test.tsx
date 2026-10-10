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

// The tooltip that says why a control waits measures itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

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
/** Unfolds a row's More list, where every action but the lead one sits. */
function openMore(row: Pick<typeof screen, "getByRole">) {
  fireEvent.click(row.getByRole("button", { name: /^More actions for/ }));
}
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
      "The counterparty signer can't use the Fil One countersigner's email.",
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
    screen.getByText(/, Signed, effective Apr 1, 2025, owner Morgan Lee/),
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
  openMore(row("Example Corporation"));
  openMore(row("Signed Elsewhere Co"));
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

it("explains a SignWell draft whose fields do not match the template, and offers a void", () => {
  render(
    <MndaWorkspace
      initial={data([
        { ...sent, state: "attention", error: "signwell_fields_mismatch" },
      ])}
      initialQuery={query}
    />,
  );
  const row = within(
    screen.getByText("Example Corporation").closest("tr") as HTMLElement,
  );
  expect(
    row.getByText(
      /SignWell's copy of this MNDA has fields that do not match the template\./,
    ),
  ).toBeVisible();
  expect(
    row.getByText(
      /Void it and send again\. If it happens again, tell engineering\./,
    ),
  ).toBeVisible();
  expect(row.queryByText(/SignWell stopped/)).toBeNull();
  // Nothing to repair in place: the row leads with a status check.
  expect(row.getByRole("button", { name: "Check status" })).toBeVisible();
  openMore(row);
  expect(row.getByRole("button", { name: "Void" })).toBeVisible();
  expect(row.queryByRole("button", { name: "Fix email" })).toBeNull();
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
  openMore(screen);
  fireEvent.click(
    screen.getByRole("button", { name: "New MNDA from this one" }),
  );
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
    expect(screen.getByText("Opened")).toBeVisible();
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
  expect(screen.getByText(/The counterparty's email bounced\./)).toBeVisible();
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
  fireEvent.click(
    screen.getByRole("button", { name: "Waiting on counterparty" }),
  );
  await waitFor(() =>
    expect(mocks.load).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ["sending", "sent", "viewed"],
        page: 1,
      }),
    ),
  );
  expect(replace).toHaveBeenLastCalledWith(
    null,
    "",
    expect.stringContaining("?status=sending%2Csent%2Cviewed"),
  );
  expect(
    screen.getByRole("button", { name: "Waiting on counterparty" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: "Only mine" }));
  await waitFor(() =>
    expect(mocks.load).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: ["sending", "sent", "viewed"],
        mine: true,
      }),
    ),
  );
  expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/internal/mndas/export?status=sending%2Csent%2Cviewed&mine=1",
  );
});

it("voids a sent MNDA only after a reason is given", async () => {
  mocks.void.mockResolvedValue({
    ok: true,
    value: { ...sent, state: "canceled", cancelReason: "Wrong entity" },
  });
  render(<MndaWorkspace initial={data([sent])} initialQuery={query} />);
  openMore(screen);
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
    await screen.findByText(
      "MNDA voided. The counterparty can no longer sign it.",
    ),
  ).toBeVisible();
});

it("says a draft SignWell is still preparing was not sent", async () => {
  mocks.operate.mockResolvedValueOnce({ ok: false, code: "still_preparing" });
  render(
    <MndaWorkspace initial={data([fixtureRecord])} initialQuery={query} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm and send" }),
  );
  expect(
    await screen.findByText(
      "SignWell is still preparing this MNDA, so it was not sent. Send it again in a minute. Until then it stays under Drafts.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/Sent to/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Confirm and send" }),
  ).toBeEnabled();
});

it("names whoever SignWell says was reminded, and says when nobody was", async () => {
  mocks.loadRegister.mockResolvedValue({
    ok: true,
    value: { register: data([sent]).register },
  });
  mocks.operate.mockResolvedValueOnce({
    ok: true,
    value: { ...sent, state: "awaiting_countersignature" },
  });
  render(<MndaWorkspace initial={data([sent])} initialQuery={query} />);
  fireEvent.click(screen.getByRole("button", { name: "Remind Alex Example" }));
  expect(await screen.findByText("Reminder sent to James Kurz.")).toBeVisible();
  mocks.operate.mockResolvedValueOnce({ ok: false, code: "not_pending" });
  fireEvent.click(
    await screen.findByRole("button", { name: "Remind Alex Example" }),
  );
  expect(
    await screen.findByText(
      "This MNDA is no longer waiting on anyone. Its row shows its current status.",
    ),
  ).toBeVisible();
  mocks.operate.mockResolvedValueOnce({
    ok: false,
    code: "remind_needs_attention",
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Remind Alex Example" }),
  );
  expect(
    await screen.findByText(
      "No reminder was sent. This MNDA needs attention first, and its row says why and what to do next.",
    ),
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

it("turns off every control the demo would refuse and says why", () => {
  render(
    <MndaWorkspace
      initial={{
        ...data([fixtureRecord, { ...sent, id: fixtureInput.countersignerId }]),
        ready: false,
        demo: true,
      }}
      initialQuery={query}
    />,
  );
  expect(
    screen.getByText(/Demo register: the companies and people are fictional/),
  ).toBeVisible();
  expect(
    screen.queryByText(/Sending is unavailable until the signing connection/),
  ).toBeNull();
  for (const button of screen.getAllByRole("button", {
    name: /^More actions for/,
  }))
    fireEvent.click(button);
  // Each refused control stays in reach and says why on hover and focus.
  for (const name of [
    "New MNDA",
    "Continue",
    "Discard draft",
    "New MNDA from this one",
    /^Remind/,
    "Fix email",
    "Check status",
    "Void",
  ])
    for (const button of screen.getAllByRole("button", { name }))
      expect(button).toHaveAttribute("aria-disabled", "true");
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
  for (const company of ["Example Corporation", "Colleague Co", "Signed Co"])
    openMore(row(company));
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

it("offers to record a contract from a signed MNDA only", () => {
  const signed: MndaRecord = {
    ...sent,
    id: "019a44ac-0000-7000-8000-000000000011",
    input: { ...fixtureInput, company: "Signed Co" },
    state: "completed",
    completedAt: "2026-09-28T00:00:00Z",
  };
  const { unmount } = render(
    <MndaWorkspace
      initial={{ ...data([signed, sent]), canRecordContracts: true }}
      initialQuery={query}
    />,
  );
  const row = (company: string) =>
    within(screen.getByText(company).closest("tr") as HTMLElement);
  openMore(row("Signed Co"));
  openMore(row(fixtureInput.company));
  expect(
    row("Signed Co").getByRole("link", { name: "Record a contract" }),
  ).toHaveAttribute("href", `/internal/contracts/new?mnda=${signed.id}`);
  expect(
    row(fixtureInput.company).queryByRole("link", {
      name: "Record a contract",
    }),
  ).toBeNull();
  unmount();
  // Without contract:write the link would open a page that refuses them.
  render(<MndaWorkspace initial={data([signed])} initialQuery={query} />);
  openMore(screen);
  expect(screen.queryByRole("link", { name: "Record a contract" })).toBeNull();
});

it("shows the legal name the partner signed as when it differs from what staff entered", () => {
  const signed = (id: string, company: string, legalName: string) => ({
    ...sent,
    id,
    input: { ...fixtureInput, company },
    state: "completed" as const,
    completedAt: "2026-09-28T00:00:00Z",
    partnerDetails: { company_sign: legalName },
  });
  render(
    <MndaWorkspace
      initial={data([
        signed(
          "019a44ac-0000-7000-8000-000000000012",
          "Harbor deal",
          "Harbor Holdings, LLC",
        ),
        signed(
          "019a44ac-0000-7000-8000-000000000013",
          "Same Name Inc.",
          "same name inc.",
        ),
      ])}
      initialQuery={query}
    />,
  );
  const row = (company: string) =>
    within(screen.getByText(company).closest("tr") as HTMLElement);
  expect(
    row("Harbor deal").getByText("Signed as Harbor Holdings, LLC"),
  ).toBeInTheDocument();
  expect(row("Same Name Inc.").queryByText(/Signed as/)).toBeNull();
});

it("leads each row with one action for its state and folds the rest under More", () => {
  const at = (
    n: number,
    company: string,
    patch: Partial<MndaRecord>,
  ): MndaRecord => ({
    ...sent,
    id: `019a44ac-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`,
    input: { ...sent.input, company },
    ...patch,
  });
  render(
    <MndaWorkspace
      initial={data([
        { ...fixtureRecord, input: { ...fixtureInput, company: "Draft Co" } },
        at(1, "Sent Co", {}),
        at(2, "Countersign Co", { state: "awaiting_countersignature" }),
        at(3, "Bounced Co", { state: "attention", error: "recipient_bounced" }),
        at(4, "Stopped Co", {
          state: "attention",
          error: "deleted_in_signwell",
        }),
        at(5, "Signed Co", {
          state: "completed",
          completedAt: "2026-09-28T00:00:00Z",
        }),
        at(6, "Expired Co", { state: "expired" }),
        at(7, "Voided Co", { state: "canceled", cancelCode: "voided" }),
      ])}
      initialQuery={query}
    />,
  );
  const lead = (company: string) => {
    const row = within(screen.getByText(company).closest("tr") as HTMLElement);
    const cell = within(
      row.getByRole("button", { name: /^More actions for/ })
        .parentElement as HTMLElement,
    );
    return [...cell.queryAllByRole("button"), ...cell.queryAllByRole("link")]
      .map((control) => control.textContent)
      .filter((name) => name !== "More");
  };
  expect(lead("Draft Co")).toEqual(["Continue"]);
  expect(lead("Sent Co")).toEqual(["Remind Alex Example"]);
  expect(lead("Countersign Co")).toEqual(["Remind James Kurz"]);
  expect(lead("Bounced Co")).toEqual(["Fix email"]);
  expect(lead("Stopped Co")).toEqual(["Check status"]);
  expect(lead("Signed Co")).toEqual(["Signed PDF"]);
  expect(lead("Expired Co")).toEqual(["New MNDA from this one"]);
  expect(lead("Voided Co")).toEqual(["New MNDA from this one"]);
  // Void comes last, after the other actions.
  const row = within(screen.getByText("Sent Co").closest("tr") as HTMLElement);
  openMore(row);
  const more = row.getAllByRole("listitem").map((item) => item.textContent);
  expect(more).toEqual([
    "Open PDF",
    "Fix email",
    "Check status",
    "New MNDA from this one",
    "Void",
  ]);
});

it("says why a control waits for the signing connection", async () => {
  render(
    <MndaWorkspace
      initial={{ ...data([sent]), ready: false }}
      initialQuery={query}
    />,
  );
  const remind = screen.getByRole("button", { name: "Remind Alex Example" });
  expect(remind).toHaveAttribute("aria-disabled", "true");
  expect(remind).toBeEnabled();
  fireEvent.click(remind);
  expect(mocks.operate).not.toHaveBeenCalled();
  act(() => remind.focus());
  expect(
    (await screen.findAllByText("Sending is off until signing is connected."))
      .length,
  ).toBeGreaterThan(0);
});

it("opens a new MNDA when asked to compose, then drops the flag", () => {
  window.history.replaceState(null, "", "/internal/mndas?compose=1&mine=1");
  const replace = vi.spyOn(window.history, "replaceState");
  render(<MndaWorkspace initial={data()} initialQuery={query} compose />);
  expect(screen.getByLabelText(/Counterparty legal name/)).toHaveValue("");
  expect(replace).toHaveBeenCalledWith(null, "", "/internal/mndas?mine=1");
});

it("does not compose in the demo", () => {
  render(
    <MndaWorkspace
      initial={{ ...data(), ready: false, demo: true }}
      initialQuery={query}
      compose
    />,
  );
  expect(screen.queryByLabelText(/Counterparty legal name/)).toBeNull();
});

it("names a draft closed before sending Discarded, and shows the signed date or a dash once closed", () => {
  render(
    <MndaWorkspace
      initial={data([
        {
          ...fixtureRecord,
          state: "canceled",
          cancelCode: "discarded",
          input: { ...fixtureInput, company: "Never Sent Co" },
        },
        {
          ...sent,
          state: "canceled",
          cancelCode: "voided",
          cancelReason: "Wrong entity",
        },
        {
          ...sent,
          id: "019a44ac-0000-7000-8000-000000000199",
          state: "completed",
          completedAt: "2026-10-08T12:00:00Z",
          input: { ...fixtureInput, company: "Signed Co" },
        },
      ])}
      initialQuery={query}
    />,
  );
  const row = (company: string) =>
    within(screen.getByText(company).closest("tr") as HTMLElement);
  expect(row("Never Sent Co").getByText("Discarded")).toBeVisible();
  expect(row("Example Corporation").getByText("Voided")).toBeVisible();
  expect(row("Example Corporation").getByText("–")).toBeVisible();
  expect(row("Signed Co").getByText("Signed Oct 8, 2026")).toBeVisible();
});
