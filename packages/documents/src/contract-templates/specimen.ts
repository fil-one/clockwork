import {
  printableTemplateValue,
  type Money,
  type TemplateField,
  type TemplateLineItems,
  type TemplateSection,
  type TemplateValue,
} from "@clockwork/contracts";
import { indicativeLinePrice } from "@clockwork/domain/core";
import type { PreparedTemplateInput } from "./definition";

// One row as a pricing scenario import brings it, one entered by hand.
const sampleRows = [
  {
    sku: "SAMPLE-STORAGE",
    description: "Sample description",
    region: "sample-region",
    unit: "TB-month",
    quantity: "100",
    termMonths: 12,
    unitPriceMinor: "1500",
    minimumQuantity: "10",
    discountBps: 1000,
  },
  {
    sku: "SAMPLE-SERVICE",
    description: "Sample service",
    region: "",
    unit: "engagement",
    quantity: "1",
    termMonths: 1,
    unitPriceMinor: "250000",
    minimumQuantity: "0",
    discountBps: 0,
  },
];

const sampleTable: TemplateLineItems = {
  currency: "USD",
  rows: sampleRows.map((row) => ({
    ...row,
    extendedMinor: indicativeLinePrice({
      ...row,
      unitPrice: { currency: "USD", minor: row.unitPriceMinor } as Money,
    }).total.minor,
  })),
};

/**
 * Sample values for a specimen PDF: every field filled with its default or a
 * visible sample, and every optional section in, including each alternative
 * a choice field selects, so the specimen shows all of the wording.
 */
export function specimenTemplateInput(
  template: {
    fields: readonly TemplateField[];
    sections: readonly TemplateSection[];
  },
  effectiveDate: string,
): PreparedTemplateInput {
  const driving = (field: TemplateField) =>
    field.options?.find((option) =>
      template.sections.some(
        (section) =>
          section.when?.field === field.id &&
          section.when.in.includes(option.value),
      ),
    )?.value;
  const sample = (field: TemplateField): TemplateValue => {
    switch (field.kind) {
      case "line_items":
        return sampleTable;
      case "choice":
        return (
          driving(field) ?? field.default ?? field.options?.[0]?.value ?? ""
        );
      case "date":
        return field.default ?? effectiveDate;
      case "email":
        return field.default ?? "sample@example.com";
      case "number":
        return field.default ?? "12";
      case "decimal":
        return field.default ?? "250000";
      case "percent":
        return field.default ?? "10";
      default:
        return (
          field.default ??
          `Sample ${[...field.label.en].filter(printableTemplateValue).join("")}`.slice(
            0,
            field.maxLength ?? 200,
          )
        );
    }
  };
  return {
    contractId: "00000000-0000-4000-8000-000000000000",
    counterpartyName: "Sample Counterparty Inc.",
    effectiveDate,
    values: Object.fromEntries(
      template.fields.map((field) => [field.id, sample(field)]),
    ),
    sections: template.sections.map((section) => section.id),
    everySection: true,
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
  };
}
