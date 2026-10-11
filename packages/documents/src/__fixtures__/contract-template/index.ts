// Test-only. These templates prove the prepare, approve, send and archive
// engine end to end without agreement wording. They are never served to
// staff; `registry.test.ts` fails if a demo template ever reuses their ids.
import { availableTemplate } from "../../contract-templates/render";
import type { ContractTemplateRegistry } from "../../contract-templates/definition";
import template from "./template.json";

export { default as fixtureSectionsContent } from "./sections.json";

export const fixtureContractTemplate = availableTemplate(template);

/** The fixture alone, for tests that prepare one. */
export const fixtureContractTemplateRegistry: ContractTemplateRegistry = [
  fixtureContractTemplate,
];
