// Renders a specimen PDF of an available contract template, for counsel to
// compare with their approved wording before the template is used.
//
//   pnpm exec tsx scripts/render-contract-specimen.ts <template-id> <output.pdf>
//
// Every field is filled with a visible sample value. `--fixture` also loads
// the test-only fixture template, to try the script without legal wording.
import { writeFileSync } from "node:fs";

import { fixtureContractTemplateRegistry } from "../packages/documents/src/__fixtures__/contract-template";
import {
  availableContractTemplate,
  contractTemplates,
} from "../packages/documents/src/contract-templates";

const args = process.argv.slice(2).filter((arg) => arg !== "--fixture");
const [templateId, output] = args;
if (!templateId || !output) {
  console.error(
    "Usage: pnpm exec tsx scripts/render-contract-specimen.ts <template-id> <output.pdf> [--fixture]",
  );
  process.exit(2);
}
const registry = process.argv.includes("--fixture")
  ? fixtureContractTemplateRegistry
  : contractTemplates;
const template = availableContractTemplate(registry, templateId);
const sample = (label: string) => `Sample ${label}`.slice(0, 120);
async function main(output: string) {
  const rendered = await template.render({
    contractId: "00000000-0000-4000-8000-000000000000",
    counterpartyName: "Sample Counterparty Inc.",
    effectiveDate: new Date().toISOString().slice(0, 10),
    values: Object.fromEntries(
      template.fields.map((field) => [
        field.id,
        field.kind === "choice"
          ? (field.options?.[0]?.value ?? "")
          : field.kind === "date"
            ? new Date().toISOString().slice(0, 10)
            : field.kind === "number"
              ? "1"
              : field.kind === "email"
                ? "sample@example.com"
                : sample(field.label.en),
      ]),
    ),
    signer: {
      name: "Sample Signer",
      email: "signer@example.com",
      title: "Sample Title",
    },
    countersigner: {
      name: "Sample Countersigner",
      email: "countersigner@example.com",
      title: "Sample Title",
    },
  });
  writeFileSync(output, rendered.bytes);
  console.log(
    `${template.name} ${template.version}: ${rendered.pages} pages, SHA-256 ${rendered.sha256}, source ${template.templateHash}`,
  );
}

void main(output);
