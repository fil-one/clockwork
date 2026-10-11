// Renders a specimen PDF of a contract template, the same specimen the
// template store's "Preview specimen PDF" shows: every optional section in,
// and every field filled with its default or a visible sample value.
//
//   pnpm exec tsx scripts/render-contract-specimen.ts <template.json> <output.pdf>
//   pnpm exec tsx scripts/render-contract-specimen.ts --demo <template-id> <output.pdf>
//
// The JSON is a template file as the store imports it. A file that does not
// validate prints its problems and writes nothing.
import { readFileSync, writeFileSync } from "node:fs";

import { TemplateContentSchema } from "../packages/contracts/src";
import {
  availableContractTemplate,
  demoContractTemplates,
  specimenTemplateInput,
  templateFromContent,
} from "../packages/documents/src/contract-templates";

const demo = process.argv.includes("--demo");
const [source, output] = process.argv
  .slice(2)
  .filter((arg) => arg !== "--demo");
if (!source || !output) {
  console.error(
    "Usage: pnpm exec tsx scripts/render-contract-specimen.ts [--demo] <template.json | demo-template-id> <output.pdf>",
  );
  process.exit(2);
}

function template(source: string) {
  if (demo) return availableContractTemplate(demoContractTemplates, source);
  const parsed = TemplateContentSchema.safeParse(
    JSON.parse(readFileSync(source, "utf8")),
  );
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      console.error(`${issue.path.join(".") || "template"}: ${issue.message}`);
    process.exit(1);
  }
  return templateFromContent(parsed.data, "specimen");
}

async function main(source: string, output: string) {
  const chosen = template(source);
  const rendered = await chosen.render(
    specimenTemplateInput(chosen, new Date().toISOString().slice(0, 10)),
  );
  writeFileSync(output, rendered.bytes);
  console.log(
    `${chosen.name}: ${rendered.pages} pages, PDF SHA-256 ${rendered.sha256}, content SHA-256 ${chosen.templateHash}`,
  );
}

void main(source, output);
