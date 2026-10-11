import { describe, expect, it } from "vitest";
import { TemplateContentSchema } from "@clockwork/contracts";
import {
  blankTemplate,
  groupTemplates,
  issueLocation,
  optionsFromText,
  optionsText,
  tableRows,
  tableText,
} from "./model";

describe("template editor model", () => {
  it("starts a blank template that validates", () => {
    expect(
      TemplateContentSchema.safeParse(
        blankTemplate("referral-agreement", "Referral Agreement", "other"),
      ).success,
    ).toBe(true);
  });

  it("edits tables and options as text and back", () => {
    const rows = tableRows("Element | Value\n\nFee | [[fee]]% \n");
    expect(rows).toEqual([
      ["Element", "Value"],
      ["Fee", "[[fee]]%"],
    ]);
    expect(tableText({ type: "table", header: true, rows })).toBe(
      "Element | Value\nFee | [[fee]]%",
    );
    expect(tableRows("")).toEqual([[""]]);
    // A | inside a cell survives a round trip.
    const piped = {
      type: "table" as const,
      header: true,
      rows: [["A | B", "C"]],
    };
    expect(tableText(piped)).toBe("A \\| B | C");
    expect(tableRows(tableText(piped))).toEqual([["A | B", "C"]]);
    const options = optionsFromText("Option B\nOption A | Option A: resale\n");
    expect(options).toEqual([
      { value: "Option B", label: { en: "Option B" } },
      { value: "Option A", label: { en: "Option A: resale" } },
    ]);
    expect(optionsText(options)).toBe("Option B\nOption A | Option A: resale");
  });

  it("names where an issue is", () => {
    const content = blankTemplate("x", "X", "other");
    expect(
      issueLocation(
        { path: ["document", "blocks", 1], message: "undeclared token" },
        content,
      ),
    ).toEqual({
      id: "operations.contractTemplates.issue.block",
      values: { number: 2, type: "paragraph" },
    });
    expect(
      issueLocation(
        { path: ["fields", 0, "default"], message: "" },
        {
          fields: [
            {
              id: "fee",
              kind: "percent",
              required: true,
              label: { en: "Fee" },
            },
          ],
        },
      ),
    ).toEqual({
      id: "operations.contractTemplates.issue.fields",
      values: { id: "fee", detail: "default" },
    });
    expect(issueLocation({ path: [], message: "" }, null).id).toBe(
      "operations.contractTemplates.issue.other",
    );
  });
});

describe("template list", () => {
  const row = (key: string, version: number, status: string, name = key) =>
    ({
      id: `${key}-${version}`,
      key,
      version,
      versionLabel: `v${version}`,
      name,
      status,
    }) as Parameters<typeof groupTemplates>[0][number];

  it("groups versions by template, newest first, with the one in use", () => {
    const groups = groupTemplates([
      row("msa", 1, "retired", "Customer MSA"),
      row("cpa", 1, "draft", "Channel Partnership Agreement"),
      row("msa", 3, "draft", "Customer MSA (draft)"),
      row("msa", 2, "active", "Customer MSA"),
    ]);
    expect(
      groups.map((g) => [g.key, g.name, g.active?.version ?? null]),
    ).toEqual([
      ["cpa", "Channel Partnership Agreement", null],
      ["msa", "Customer MSA", 2],
    ]);
    expect(groups[1]?.versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });
});
