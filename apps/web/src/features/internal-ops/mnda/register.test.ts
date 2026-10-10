import { expect, it } from "vitest";
import { fixtureRecord } from "../../../../../../packages/contracts/src/mnda-fixture";
import {
  contentDisposition,
  mndaDaysOutstanding,
  mndaPdfFilename,
  mndaRegisterCsv,
} from "./register";

const now = Date.parse("2026-10-10T12:00:00Z");

it("counts days outstanding only while a request is open", () => {
  const sent = { state: "sent" as const, sentAt: "2026-10-01T09:00:00Z" };
  expect(mndaDaysOutstanding(sent, now)).toBe(9);
  expect(mndaDaysOutstanding({ ...sent, state: "attention" }, now)).toBe(9);
  expect(mndaDaysOutstanding({ ...sent, state: "completed" }, now)).toBeNull();
  expect(mndaDaysOutstanding({ state: "draft", sentAt: null }, now)).toBeNull();
});

it("names PDFs for a deal folder without unsafe characters", () => {
  expect(mndaPdfFilename(fixtureRecord, "original")).toBe(
    "Fil-One-MNDA_Example-Corporation_2026-10-02_draft.pdf",
  );
  expect(
    mndaPdfFilename(
      {
        input: {
          ...fixtureRecord.input,
          company: 'Société Générale / "Paris"',
        },
        completedAt: "2026-10-05T23:00:00Z",
      },
      "executed",
    ),
  ).toBe("Fil-One-MNDA_Societe-Generale-Paris_2026-10-05_signed.pdf");
  expect(contentDisposition('a"b.pdf', "inline")).toBe(
    `inline; filename="a_b.pdf"; filename*=UTF-8''a%22b.pdf`,
  );
});

it("writes RFC 4180 CSV that spreadsheet apps cannot execute", () => {
  const csv = mndaRegisterCsv(
    [
      {
        ...fixtureRecord,
        input: {
          ...fixtureRecord.input,
          company: '=HYPERLINK("x"), Inc',
          signerName: "Line\nbreak",
        },
        cancelCode: "superseded",
      },
      {
        ...fixtureRecord,
        state: "canceled",
        cancelCode: "signer_change",
      },
    ],
    { status: () => "Draft", signerChange: "A different person will sign." },
    now,
  );
  expect(csv.startsWith("\u{feff}Company,Partner signer,")).toBe(true);
  expect(csv).toContain(`"'=HYPERLINK(""x""), Inc","Line\nbreak"`);
  expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  expect(csv).not.toContain("superseded");
  expect(csv).toContain("A different person will sign.");
});

it("exports what the partner entered at signing after the existing columns", () => {
  const completed = {
    ...fixtureRecord,
    state: "completed" as const,
    completedAt: "2026-10-05T00:00:00Z",
  };
  const csv = mndaRegisterCsv(
    [
      {
        ...completed,
        partnerDetails: {
          company_intro: "Harbor Holdings, LLC",
          entity: "Delaware limited liability company",
          signer_title: "=COO",
          street_intro: "1 Pier",
          locality_intro: "Boston, MA",
          email_intro: "legal@harbor.test",
        },
      },
      { ...completed, partnerDetails: {} },
      fixtureRecord,
    ],
    { status: () => "Signed", signerChange: "" },
    now,
  );
  const [header, harbor, unreported, none] = csv.trimEnd().split("\r\n");
  const columns = header?.replace("\u{feff}", "").split(",") ?? [];
  expect(columns.slice(14)).toEqual([
    "Request ID",
    "Partner details",
    "Partner legal name",
    "Partner jurisdiction and entity type",
    "Partner short name",
    "Partner signer name",
    "Partner signer title",
    "Partner notice contact",
    "Partner notice email",
    "Partner notice address",
  ]);
  expect(harbor).toContain(
    `${fixtureRecord.id},reported,"Harbor Holdings, LLC",Delaware limited liability company,,,'=COO,,legal@harbor.test,"1 Pier, Boston, MA"`,
  );
  expect(unreported?.endsWith(`${fixtureRecord.id},not_reported,,,,,,,,`)).toBe(
    true,
  );
  expect(none?.endsWith(`${fixtureRecord.id},,,,,,,,,`)).toBe(true);
});
