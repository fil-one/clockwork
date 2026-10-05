import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fixtureContractTemplate,
  fixtureContractTemplateRegistry,
} from "../__fixtures__/contract-template";
import fixtureFile from "../__fixtures__/contract-template/template.json";
import { TemplateFileSchema } from "./definition";
import { availableContractTemplate, contractTemplates } from "./registry";

const repositoryRoot = new URL("../../../../", import.meta.url);

describe("production contract templates", () => {
  it("lists one pending template per agreement counsel has not yet supplied", () => {
    expect(contractTemplates.map((t) => [t.contractType, t.status])).toEqual([
      ["channel_partnership", "pending_legal"],
      ["customer_msa", "pending_legal"],
      ["order_form", "pending_legal"],
      ["dpa", "pending_legal"],
      ["security_annex", "pending_legal"],
      ["nda_one_way", "pending_legal"],
      ["technology_partner", "pending_legal"],
      ["sow", "pending_legal"],
    ]);
    expect(new Set(contractTemplates.map((t) => t.id)).size).toBe(
      contractTemplates.length,
    );
  });

  it("never registers the test fixture", () => {
    expect(contractTemplates).not.toContain(fixtureContractTemplate);
    expect(contractTemplates.some((t) => t.id.startsWith("test"))).toBe(false);
    expect(fixtureContractTemplateRegistry).toContain(fixtureContractTemplate);
  });

  it("pins every available template to counsel's source file by SHA-256", () => {
    for (const template of fixtureContractTemplateRegistry) {
      if (template.status !== "available") continue;
      const source = readFileSync(new URL(template.sourcePath, repositoryRoot));
      expect(createHash("sha256").update(source).digest("hex")).toBe(
        template.templateHash,
      );
    }
  });

  it("refuses to prepare a template that is pending from legal", () => {
    expect(() =>
      availableContractTemplate(contractTemplates, "channel-partnership"),
    ).toThrow("CONTRACT_TEMPLATE_PENDING_LEGAL");
    expect(() =>
      availableContractTemplate(contractTemplates, "missing"),
    ).toThrow("CONTRACT_TEMPLATE_NOT_FOUND");
    expect(
      availableContractTemplate(fixtureContractTemplateRegistry, "test-fixture")
        .requiresApproval,
    ).toBe(true);
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
    } as (typeof broken.fields)[number]);
    expect(TemplateFileSchema.safeParse(broken).success).toBe(false);
  });

  it("requires options for choice fields only", () => {
    const broken = structuredClone(fixtureFile);
    delete (broken.fields[1] as { options?: unknown }).options;
    expect(TemplateFileSchema.safeParse(broken).success).toBe(false);
  });
});
