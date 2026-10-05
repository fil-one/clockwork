import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fixtureContractTemplate } from "../__fixtures__/contract-template";
import type { PreparedTemplateInput } from "./definition";

const input: PreparedTemplateInput = {
  contractId: "019a44ac-0000-7000-8000-00000000c0de",
  counterpartyName: "Bluefin Data Co.",
  effectiveDate: "2026-10-05",
  values: {
    fixture_reference: "REF-7",
    fixture_tier: "beta",
    fixture_note: "",
  },
  signer: { name: "Alex Example", email: "alex@example.com", title: "CEO" },
  countersigner: {
    name: "James Kurz",
    email: "james@example.com",
    title: "CFO/CSO",
  },
};

function text(bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), "contract-template-"));
  try {
    writeFileSync(join(dir, "document.pdf"), bytes);
    return execFileSync(
      "pdftotext",
      ["-layout", join(dir, "document.pdf"), "-"],
      {
        encoding: "utf8",
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("renders resolved fields, both signers and four signing tags deterministically", async () => {
  const [a, b] = await Promise.all([
    fixtureContractTemplate.render(input),
    fixtureContractTemplate.render(input),
  ]);
  expect(a.sha256).toBe(b.sha256);
  expect(a.pages).toBe(2);
  const rendered = text(a.bytes).replace(/\s+/g, " ");
  expect(rendered).toContain(
    "Counterparty: Bluefin Data Co.. Date: 2026-10-05.",
  );
  expect(rendered).toContain("Reference REF-7, tier beta, note .");
  for (const tag of [
    "{{signature:1:y}}",
    "{{signature:2:y}}",
    "{{af_d_s:1:y}}",
    "{{af_d_s:2:y}}",
  ])
    expect(rendered).toContain(tag);
  expect(rendered).toContain("James Kurz");
  expect(rendered).toContain("Alex Example");
  expect(rendered).toContain("019a44ac · test-fixture fixture-1");
  expect(rendered).not.toContain("[[");
}, 30_000);

it("refuses values that could form tags or that the PDF font cannot draw", async () => {
  for (const value of [
    "{{signature:1:y}}",
    "[[fixture_tier]]",
    "<b>",
    "株式会社",
  ])
    await expect(
      fixtureContractTemplate.render({
        ...input,
        values: { ...input.values, fixture_reference: value },
      }),
    ).rejects.toThrow("CONTRACT_TEMPLATE_VALUE_CHARACTERS");
});

it("fails closed when a declared field has no value", async () => {
  const values = Object.fromEntries(
    Object.entries(input.values).filter(([key]) => key !== "fixture_note"),
  );
  await expect(
    fixtureContractTemplate.render({ ...input, values }),
  ).rejects.toThrow("CONTRACT_TEMPLATE_FIELD_UNRESOLVED");
});
