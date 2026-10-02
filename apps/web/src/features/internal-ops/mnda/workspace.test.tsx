import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  fixtureRecord,
  fixtureSigner,
} from "../../../../../../packages/contracts/src/mnda-fixture";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  operate: vi.fn(),
  load: vi.fn(),
  download: vi.fn(),
  configure: vi.fn(),
}));
vi.mock("./actions", () => ({
  prepareMnda: mocks.prepare,
  operateMnda: mocks.operate,
  loadMndas: mocks.load,
  downloadMnda: mocks.download,
  configureMndaSigner: mocks.configure,
}));
import { MndaWorkspace } from "./workspace";
const initial = {
  records: [],
  signers: [fixtureSigner],
  ready: true,
  testMode: true,
  canManage: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.load.mockResolvedValue(initial);
  mocks.prepare.mockResolvedValue({
    record: fixtureRecord,
    pdf: btoa("%PDF-preview"),
  });
  mocks.operate.mockResolvedValue({ ...fixtureRecord, state: "sent" });
});
it("lets a revenue operator preview the immutable two-party document before confirming delivery", async () => {
  const { container } = render(<MndaWorkspace initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: "New MNDA" }));
  for (const [name, value] of Object.entries(fixtureRecord.input)) {
    const input = container.querySelector(`input[name="${name}"]`);
    if (input) fireEvent.change(input, { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  await screen.findByRole("link", { name: "Open PDF" });
  expect(mocks.operate).not.toHaveBeenCalled();
  expect(screen.getByText(/alex@example.com → James Kurz/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
  await waitFor(() =>
    expect(mocks.operate).toHaveBeenCalledExactlyOnceWith({
      id: fixtureRecord.id,
      operation: "send",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Confirm and send" }),
    ).not.toBeInTheDocument(),
  );
});
it("keeps delivery disabled when the provider is not configured", async () => {
  mocks.load.mockResolvedValue({ ...initial, ready: false });
  mocks.download.mockResolvedValue(btoa("%PDF-preview"));
  render(
    <MndaWorkspace
      initial={{ ...initial, ready: false, records: [fixtureRecord] }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
  expect(
    await screen.findByRole("button", { name: "Confirm and send" }),
  ).toBeDisabled();
  expect(mocks.operate).not.toHaveBeenCalled();
});

it("lets the partner supply legal details without requiring staff to know them", async () => {
  const { container } = render(<MndaWorkspace initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: "New MNDA" }));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Who completes partner details?" }),
    { target: { value: "recipient" } },
  );
  expect(
    screen.queryByLabelText("Counterparty short name"),
  ).not.toBeInTheDocument();
  for (const name of [
    "company",
    "signerName",
    "signerEmail",
    "effectiveDate",
  ] as const) {
    const input = container.querySelector(`input[name="${name}"]`);
    if (!input) throw new Error("Expected recipient field");
    fireEvent.change(input, { target: { value: fixtureRecord.input[name] } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  await screen.findByRole("link", { name: "Open PDF" });
  expect(mocks.prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      detailsMode: "recipient",
      signerEmail: fixtureRecord.input.signerEmail,
    }),
  );
  expect(mocks.operate).not.toHaveBeenCalled();
});

it("defaults to partial completion, auto-fills an editable short name and preserves known address data", async () => {
  const { container } = render(<MndaWorkspace initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: "New MNDA" }));
  expect(
    screen.getByRole("combobox", { name: "Who completes partner details?" }),
  ).toHaveValue("mixed");
  const company = screen.getByLabelText("Counterparty legal name");
  const shortName = container.querySelector('input[name="shortName"]');
  if (!shortName) throw new Error("Expected short name input");
  fireEvent.change(company, { target: { value: "Example LLC" } });
  expect(shortName).toHaveValue("Example LLC");
  expect(shortName).not.toBeRequired();
  fireEvent.change(shortName, { target: { value: "Example" } });
  fireEvent.change(company, { target: { value: "Example Holdings LLC" } });
  expect(shortName).toHaveValue("Example");
  fireEvent.change(shortName, { target: { value: "" } });
  fireEvent.blur(shortName);
  expect(shortName).toHaveValue("Example Holdings LLC");
  expect(
    screen.getByLabelText("Jurisdiction and entity type"),
  ).not.toBeRequired();
  expect(
    screen.getByLabelText("City, region, postal code, country"),
  ).not.toBeRequired();
  for (const name of ["signerName", "signerEmail", "streetAddress"] as const) {
    const input = container.querySelector(`input[name="${name}"]`);
    if (!input) throw new Error("Expected partner input");
    fireEvent.change(input, { target: { value: fixtureRecord.input[name] } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Prepare preview" }));
  await screen.findByRole("link", { name: "Open PDF" });
  expect(mocks.prepare).toHaveBeenCalledWith(
    expect.objectContaining({
      detailsMode: "mixed",
      company: "Example Holdings LLC",
      shortName: "Example Holdings LLC",
      streetAddress: fixtureRecord.input.streetAddress,
      locality: "",
      entityDescription: "",
    }),
  );
  expect(mocks.operate).not.toHaveBeenCalled();
});
