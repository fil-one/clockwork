import {
  TemplateFileSchema,
  type ContractTemplate,
  type ContractTemplateRegistry,
  type ContractTemplateSource,
  type TemplateFile,
} from "./definition";
import { availableTemplate } from "./render";
import demoChannelPartner from "./demo/channel-partner.json";
import demoOrderForm from "./demo/order-form.json";

/**
 * The guided demo's templates: short sample wording for fictional deals,
 * never used for a real contract. Live templates are kept in the template
 * store (`docs/operations/contract-templates.md`).
 */
export const demoContractTemplateFiles: readonly TemplateFile[] = [
  demoChannelPartner,
  demoOrderForm,
].map((file) => TemplateFileSchema.parse(file));

export const demoContractTemplates: ContractTemplateRegistry =
  demoContractTemplateFiles.map(availableTemplate);

export function findContractTemplate(
  registry: ContractTemplateRegistry,
  id: string,
): ContractTemplate | undefined {
  return registry.find((template) => template.id === id);
}

/** The template a preparation may use, or a coded error. */
export function availableContractTemplate(
  registry: ContractTemplateRegistry,
  id: string,
): ContractTemplate {
  const template = findContractTemplate(registry, id);
  if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
  return template;
}

/** A template source over a fixed list, for tests and the guided demo. */
export function registryTemplateSource(
  registry: ContractTemplateRegistry,
): ContractTemplateSource {
  return {
    listActive: () => Promise.resolve(registry),
    active: (id) =>
      Promise.resolve().then(() => availableContractTemplate(registry, id)),
    version: (id, version) =>
      Promise.resolve().then(() => {
        const template = availableContractTemplate(registry, id);
        if (template.version !== version)
          throw new Error("CONTRACT_TEMPLATE_VERSION_CHANGED");
        return template;
      }),
  };
}
