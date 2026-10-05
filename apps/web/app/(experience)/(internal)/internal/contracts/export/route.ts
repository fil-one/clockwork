import { ContractListQuerySchema } from "@clockwork/contracts";
import { contractToday } from "@clockwork/domain/contract-terms";
import { getTranslations } from "@/src/i18n/server";
import {
  contractPaperLabels,
  contractStatusLabels,
  contractTypeLabels,
} from "@/src/features/internal-ops/contracts/copy";
import { toCsv } from "@/src/features/internal-ops/contracts/csv";
import { jsonFailure } from "@/src/features/internal-ops/contracts/http";
import {
  contractRepository,
  contractStaff,
} from "@/src/features/internal-ops/contracts/server";

/** The register as CSV, with the same filters as the list on screen. */
export async function GET(request: Request) {
  try {
    await contractStaff("contract:read");
    const t = await getTranslations();
    const today = contractToday();
    const query = ContractListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const rows = await contractRepository().exportRows(query, today);
    const csv = toCsv(
      [
        t("operations.contracts.field.counterparty"),
        t("operations.contracts.field.title"),
        t("operations.contracts.field.type"),
        t("operations.contracts.field.paper"),
        t("operations.contracts.field.status"),
        t("operations.contracts.field.effectiveDate"),
        t("operations.contracts.field.termEnds"),
        t("operations.contracts.field.renewsOn"),
        t("operations.contracts.field.noticeDeadline"),
        t("operations.contracts.field.owner"),
        t("operations.contracts.field.tags"),
        t("operations.contracts.export.documents"),
        t("operations.contracts.export.source"),
      ],
      rows.map((row) => [
        row.counterpartyName,
        row.title,
        t(contractTypeLabels[row.contractType]),
        t(contractPaperLabels[row.paper]),
        t(contractStatusLabels[row.status]),
        row.effectiveDate,
        row.termEndDate,
        row.renewalDate,
        row.noticeDeadline,
        row.ownerName,
        row.tags.join("; "),
        row.documentCount,
        t(
          row.source === "mnda"
            ? "operations.contracts.source.mnda"
            : "operations.contracts.source.register",
        ),
      ]),
    );
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="fil-one-contracts-${today}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return jsonFailure(error);
  }
}
