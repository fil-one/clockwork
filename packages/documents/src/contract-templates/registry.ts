import {
  pendingTemplate,
  type AvailableContractTemplate,
  type ContractTemplate,
  type ContractTemplateRegistry,
} from "./definition";

/**
 * Every contract template staff can see. Entries marked `pending_legal` are
 * placeholders until counsel supplies approved wording; they carry no text
 * and cannot be prepared. To add one, follow
 * `docs/operations/contract-templates.md`: add `<id>/template.json` beside
 * this file and replace the matching stub with `availableTemplate(json)`.
 */
export const contractTemplates: ContractTemplateRegistry = [
  pendingTemplate(
    "channel-partnership",
    "channel_partnership",
    "Channel Partnership Agreement",
  ),
  pendingTemplate(
    "customer-msa",
    "customer_msa",
    "Customer Master Services Agreement",
  ),
  pendingTemplate("order-form", "order_form", "Order Form"),
  pendingTemplate("dpa", "dpa", "Data Processing Addendum"),
  pendingTemplate("security-annex", "security_annex", "Security Annex"),
  pendingTemplate(
    "nda-one-way",
    "nda_one_way",
    "One-way Non-Disclosure Agreement",
  ),
  pendingTemplate(
    "technology-partner",
    "technology_partner",
    "Technology Partner Agreement",
  ),
  pendingTemplate("sow", "sow", "Statement of Work"),
];

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
): AvailableContractTemplate {
  const template = findContractTemplate(registry, id);
  if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
  if (template.status !== "available")
    throw new Error("CONTRACT_TEMPLATE_PENDING_LEGAL");
  return template;
}
