// Test-only. This template proves the prepare, approve, send and archive
// engine end to end without legal wording. It is never part of
// `contractTemplates`; `registry.test.ts` fails if it ever is.
import { availableTemplate } from "../../contract-templates/render";
import { contractTemplates } from "../../contract-templates/registry";
import type { ContractTemplateRegistry } from "../../contract-templates/definition";
import template from "./template.json";

export const fixtureContractTemplate = availableTemplate(template);

/** The production registry plus the fixture, for tests that prepare one. */
export const fixtureContractTemplateRegistry: ContractTemplateRegistry = [
  ...contractTemplates,
  fixtureContractTemplate,
];
