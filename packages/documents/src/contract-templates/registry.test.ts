import { describe, expect, it } from "vitest";
import {
  includedTemplateSections,
  templateContentJson,
  type TemplateContent,
} from "@clockwork/contracts";
import {
  fixtureContractTemplate,
  fixtureSectionsContent,
} from "../__fixtures__/contract-template";
import fixtureFile from "../__fixtures__/contract-template/template.json";
import { TemplateContentSchema, TemplateFileSchema } from "./definition";
import {
  availableContractTemplate,
  demoContractTemplates,
  registryTemplateSource,
} from "./registry";
import { derivedValues, templateContentHash } from "./render";

const sections = () =>
  structuredClone(fixtureSectionsContent) as unknown as Record<
    string,
    unknown
  > & {
    fields: Record<string, unknown>[];
    sections: Record<string, unknown>[];
    derived: Record<string, unknown>[];
    document: { title: string; blocks: Record<string, unknown>[] };
  };
const problems = (raw: unknown) =>
  TemplateContentSchema.safeParse(raw).error?.issues.map(
    (issue) => issue.message,
  ) ?? [];

describe("templates kept in code", () => {
  it("are the guided demo's samples, clearly marked and never the fixture", () => {
    expect(demoContractTemplates.map((t) => t.id)).toEqual([
      "sample-channel-partner",
      "sample-order-form",
    ]);
    for (const template of demoContractTemplates) {
      expect(template.name).toMatch(/^Sample /);
      expect(template.sourceNote).toMatch(/^Demo sample wording/);
    }
    expect(demoContractTemplates).not.toContain(fixtureContractTemplate);
  });

  it("finds a template by id and pins the version a form was built for", async () => {
    const source = registryTemplateSource(demoContractTemplates);
    expect(() =>
      availableContractTemplate(demoContractTemplates, "missing"),
    ).toThrow("CONTRACT_TEMPLATE_NOT_FOUND");
    await expect(
      source.version("sample-order-form", "demo-1"),
    ).resolves.toMatchObject({ id: "sample-order-form" });
    await expect(source.version("sample-order-form", "demo-0")).rejects.toThrow(
      "CONTRACT_TEMPLATE_VERSION_CHANGED",
    );
    await expect(source.active("missing")).rejects.toThrow(
      "CONTRACT_TEMPLATE_NOT_FOUND",
    );
  });
});

describe("content hash", () => {
  const content = TemplateContentSchema.parse(fixtureSectionsContent);

  it("is the same for the same content in any key order, without the note", () => {
    const reordered = TemplateContentSchema.parse(
      Object.fromEntries(Object.entries(sections()).reverse()),
    );
    expect(templateContentHash(reordered)).toBe(templateContentHash(content));
    expect(
      templateContentHash({ ...content, sourceNote: "Another note" }),
    ).toBe(templateContentHash(content));
    expect(templateContentJson(content)).not.toContain("sourceNote");
    expect(templateContentHash(content)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with any wording, field or section change", () => {
    const base = templateContentHash(content);
    const changes: ((c: TemplateContent) => void)[] = [
      (c) => {
        const block = c.document.blocks[0];
        if (block?.type === "paragraph") block.text += " ";
      },
      (c) => {
        if (c.fields[1]) c.fields[1].required = false;
      },
      (c) => {
        if (c.sections[1]) c.sections[1].default = false;
      },
      (c) => {
        c.requiresApproval = true;
      },
    ];
    for (const change of changes) {
      const changed = structuredClone(content);
      change(changed);
      expect(templateContentHash(changed)).not.toBe(base);
    }
  });
});

describe("optional sections", () => {
  const content = TemplateContentSchema.parse(fixtureSectionsContent);

  it("includes ticked sections and those a choice field turns on", () => {
    expect([
      ...includedTemplateSections(content, ["nfr"], { model: "Referral" }),
    ]).toEqual(["nfr"]);
    expect([
      ...includedTemplateSections(content, [], { model: "Resale" }),
    ]).toEqual(["resale"]);
    // A choice-driven section cannot be ticked on by hand.
    expect([
      ...includedTemplateSections(content, ["resale"], { model: "Referral" }),
    ]).toEqual([]);
  });

  it("refuses a section, a section field or a token that does not resolve", () => {
    const unknown = sections();
    unknown.document.blocks.push({
      type: "paragraph",
      section: "schedule_z",
      text: "Text",
    });
    expect(problems(unknown)).toContain("unknown section schedule_z");

    const outside = sections();
    outside.document.blocks.push({
      type: "paragraph",
      text: "Margin [[resale_margin]].",
    });
    expect(problems(outside)).toContain(
      "[[resale_margin]] belongs to section resale",
    );

    const driver = sections();
    driver.sections[0] = {
      id: "resale",
      label: { en: "Resale" },
      when: { field: "model", in: ["Wholesale"] },
    };
    expect(problems(driver)).toContain("Wholesale is not an option of model");

    const notChoice = sections();
    notChoice.sections[0] = {
      id: "resale",
      label: { en: "Resale" },
      when: { field: "referral_percent", in: ["10"] },
    };
    expect(problems(notChoice)).toContain(
      "referral_percent must be a choice field outside any section",
    );
  });

  it("refuses characters the PDF cannot print and stray bold markers", () => {
    const symbol = sections();
    symbol.document.blocks.push({ type: "paragraph", text: "Uptime ≥ 99.9%" });
    expect(problems(symbol)).toContain("U+2265 (≥) cannot be printed");
    const bold = sections();
    bold.document.blocks.push({ type: "paragraph", text: "**Open bold" });
    expect(problems(bold)).toContain("unbalanced ** bold marker");
    const tag = sections();
    tag.document.blocks.push({
      type: "table",
      rows: [["{{signature:1:y}}"]],
    });
    expect(problems(tag)).toContain("{ and } are reserved for signing tags");
    // Bold markers between braces, a lone brace beside a token, or a brace
    // in the name could still print a tag; any brace is refused.
    for (const text of ["{****{signature:1:y}****}", "{[[model]]{x"]) {
      const split = sections();
      split.document.blocks.push({ type: "paragraph", text });
      expect(problems(split)).toContain(
        "{ and } are reserved for signing tags",
      );
    }
    const named = sections();
    named.name = "Probe {{signature:1:y}}";
    expect(problems(named)).toContain("{ and } are reserved for signing tags");
  });
});

describe("printed choice values and defaults", () => {
  it("refuses option values and defaults a seller value could not be", () => {
    for (const value of ["[x]", "<b>", "≥ 99.9%", "Option\u200bA"]) {
      const option = sections();
      option.fields[0] = {
        ...option.fields[0],
        options: [
          { value: "Referral", label: { en: "Referral" } },
          { value, label: { en: "Odd" } },
        ],
      };
      expect(problems(option)).toContain(
        "option values and defaults print: use characters the PDF can draw, without < > [ ] { }",
      );
    }
  });
});

describe("numeric fields and derived figures", () => {
  it("accepts percentages from 0 to 100 and decimals without business caps", () => {
    const percent = sections();
    for (const value of ["0", "32.5", "100", "99.9999"]) {
      percent.fields[1] = { ...percent.fields[1], default: value };
      expect(problems(percent)).toEqual([]);
    }
    for (const value of ["100.5", "-1", "1e2", "12.34567", "abc"]) {
      percent.fields[1] = { ...percent.fields[1], default: value };
      expect(problems(percent)).toContain(
        "the default does not suit the field",
      );
    }
    const decimal = sections();
    decimal.fields[2] = { ...decimal.fields[2], default: "999999999999999.5" };
    expect(problems(decimal)).toEqual([]);
  });

  it("works derived figures out exactly, rounding half up", () => {
    const { derived } = TemplateContentSchema.parse(fixtureSectionsContent);
    expect(
      derivedValues(
        derived,
        { referral_percent: "32.5", sample_revenue: "250000" },
        new Set(),
      ),
    ).toEqual({ sample_fee: "81,250.00", sample_three_years: "243,750" });
    expect(
      derivedValues(
        derived,
        { referral_percent: "33.3333", sample_revenue: "0.15" },
        new Set(),
      ),
    ).toEqual({ sample_fee: "0.05", sample_three_years: "0" });
    expect(() =>
      derivedValues(derived, { referral_percent: "10" }, new Set()),
    ).toThrow("CONTRACT_TEMPLATE_FIELD_UNRESOLVED");
  });

  it("builds each figure on the one before it as printed", () => {
    const printed = derivedValues(
      [
        { id: "earn", op: "percent_of", of: ["rate", "spend"], decimals: 0 },
        { id: "five", op: "product", of: ["earn", "5"], decimals: 0 },
        { id: "both", op: "sum", of: ["earn", "five"], decimals: 0 },
      ],
      { rate: "16.6667", spend: "25000" },
      new Set(),
    );
    // 16.6667% of 25,000 is 4,166.675, printed 4,167; five of those 20,835.
    expect(printed).toEqual({ earn: "4,167", five: "20,835", both: "25,002" });
  });

  it("refuses a derived operand that is not a required number", () => {
    const text = sections();
    text.derived[0] = { id: "x", op: "sum", of: ["nfr_capacity", "1"] };
    expect(problems(text)).toContain(
      "nfr_capacity must be a required numeric field or an earlier derived figure",
    );
    const later = sections();
    later.derived.reverse();
    expect(problems(later)).toContain(
      "sample_fee must be a required numeric field or an earlier derived figure",
    );
  });
});

describe("template file format", () => {
  it("rejects a token that no field declares", () => {
    const broken = structuredClone(fixtureFile);
    broken.document.blocks.push({
      type: "paragraph",
      text: "Undeclared [[rebate_rate]].",
    });
    expect(TemplateFileSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a field that reuses a standard token", () => {
    const broken = structuredClone(fixtureFile);
    broken.fields.push({
      id: "counterparty_name",
      kind: "text",
      required: true,
      label: { en: "Duplicate" },
    });
    expect(TemplateFileSchema.safeParse(broken).success).toBe(false);
  });

  it("requires options for choice fields only", () => {
    const broken = structuredClone(fixtureFile);
    delete (broken.fields[1] as { options?: unknown }).options;
    expect(TemplateFileSchema.safeParse(broken).success).toBe(false);
  });

  it("places a line-item table only as a paragraph of its own", () => {
    expect(
      fixtureContractTemplate.fields.find((f) => f.id === "fixture_lines")
        ?.kind,
    ).toBe("line_items");
    for (const block of [
      { type: "paragraph", text: "Lines: [[fixture_lines]]" },
      { type: "heading", text: "[[fixture_lines]]" },
      { type: "table", rows: [["[[fixture_lines]]"]] },
    ]) {
      const broken = structuredClone(fixtureFile) as unknown as {
        document: { blocks: unknown[] };
      };
      broken.document.blocks.push(block);
      expect(TemplateFileSchema.safeParse(broken).success).toBe(false);
    }
    const titled = structuredClone(fixtureFile);
    titled.document.title = "ORDER FORM [[fixture_lines]]";
    expect(TemplateFileSchema.safeParse(titled).success).toBe(false);
  });

  it("requires a line-item field and gives it no length or default", () => {
    for (const change of [
      { required: false },
      { maxLength: 80 },
      { default: "" },
    ]) {
      const broken = structuredClone(fixtureFile);
      Object.assign(broken.fields[3] ?? {}, change);
      expect(TemplateFileSchema.safeParse(broken).success).toBe(false);
    }
  });
});
