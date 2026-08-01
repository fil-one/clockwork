import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { demoDocuments } from "./__fixtures__/demo-documents";
import type { CommerceDocumentInput } from "./model";
import { renderCommerceDocument } from "./render";

const execute = promisify(execFile);
let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "clockwork-semantic-pdf-"));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function kindAnchors(input: CommerceDocumentInput): readonly string[] {
  switch (input.kind) {
    case "direct_quote":
    case "partner_transfer_quote":
    case "partner_resale_quote":
      return [
        input.quoteNumber,
        input.paymentTerms,
        input.lineItems[0]?.description ?? "",
      ];
    case "order_form":
      return [
        input.orderNumber,
        input.quoteReference,
        input.governingAgreementReference,
        input.signer.name,
      ];
    case "amendment":
      return [
        input.amendmentNumber,
        input.parentOrderReference,
        input.governingAgreementReference,
      ];
    case "poc_summary":
    case "poc_final_report":
      return [
        input.pocNumber,
        input.workload,
        input.capacityCap,
        input.successTests[0]?.label ?? "",
      ];
    case "invoice_companion":
    case "receipt":
      return [
        input.invoiceNumber,
        input.orderReference,
        input.paymentReference ?? input.lineItems[0]?.description ?? "",
      ];
    case "commission_statement":
      return [
        input.statementNumber,
        input.lines[0]?.invoiceReference ?? "",
        input.paymentStatus,
      ];
    case "renewal_confirmation":
    case "decline_confirmation":
      return [
        input.confirmationNumber,
        input.orderReference,
        input.agreementReference,
        input.confirmationText,
      ];
    case "deletion_certificate":
      return [
        input.certificateNumber,
        input.accountReference,
        input.deletionMethod,
        input.orchestratorConfirmation,
      ];
    case "reconciliation_report":
    case "report_export":
      return [
        input.reportTitle,
        input.basis,
        input.columns[0]?.label ?? "",
        Object.values(input.rows[0]?.values ?? {})[0] ?? "",
      ];
  }
}

describe("semantic PDF verification with Poppler", () => {
  it("extracts immutable identity, parties, version, source hash, and kind-specific truth for all 15 kinds", async () => {
    for (const input of demoDocuments) {
      const rendered = await renderCommerceDocument(input);
      const pdf = join(directory, `${input.kind}.pdf`);
      const textFile = join(directory, `${input.kind}.txt`);
      await writeFile(pdf, rendered.bytes);
      await execute("pdftotext", ["-layout", "-enc", "UTF-8", pdf, textFile]);
      const extracted = await readFile(textFile, "utf8");
      const compact = extracted.replaceAll(/\s+/g, " ").toLocaleLowerCase();
      const compactHash = extracted.replaceAll(/\s+/g, "");
      const partyAnchors =
        input.kind === "reconciliation_report" || input.kind === "report_export"
          ? []
          : [input.issuer.legalName, input.recipient.legalName];
      const anchors = [
        input.documentId,
        input.version,
        ...partyAnchors,
        ...kindAnchors(input),
      ].filter(Boolean);
      for (const anchor of anchors)
        expect(compact, `${input.kind} semantic anchor: ${anchor}`).toContain(
          anchor.toLocaleLowerCase(),
        );
      expect(compactHash, `${input.kind} immutable source hash`).toContain(
        input.verification.recordHash,
      );
    }
  }, 60_000);
});
