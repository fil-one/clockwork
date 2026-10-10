import { ContractListQuerySchema } from "@clockwork/contracts";
import { contractToday } from "@clockwork/domain/contract-terms";
import { getTranslations } from "@/src/i18n/server";
import {
  contractPaperLabels,
  contractStatusLabels,
  contractTypeLabels,
  signingStateLabels,
} from "@/src/features/internal-ops/contracts/copy";
import { listScope } from "@/src/features/internal-ops/contracts/loaders";
import { toCsv } from "@/src/features/internal-ops/contracts/csv";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import {
  contractReader,
  contractRegisterReader,
} from "@/src/features/internal-ops/contracts/demo-access";
import { jsonFailure } from "@/src/features/internal-ops/contracts/http";
import {
  contractActor,
  contractRepository,
} from "@/src/features/internal-ops/contracts/server";

/** The register as CSV, with the same filters as the list on screen. Every
 * export is audited with its filters and row counts before it is sent. */
export async function GET(request: Request) {
  try {
    const session = await contractReader("contract:read");
    const t = await getTranslations();
    const today = contractToday(demoNow());
    const query = ContractListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const { rows, truncated } = await contractRegisterReader(
      session,
    ).exportRows(query, today, listScope(session));
    // The demo register is fictional and has no audit trail to write to.
    if (!explicitDemoIdentityEnabled())
      await contractRepository().recordAccess(contractActor(session), {
        kind: "export",
        filters: query,
        rows: rows.length,
        mndaRows: rows.filter((row) => row.source === "mnda").length,
        truncated,
      });
    const csv = toCsv(
      [
        t("operations.contracts.field.counterparty"),
        t("operations.contracts.field.title"),
        t("operations.contracts.field.type"),
        t("operations.contracts.field.paper"),
        t("operations.contracts.field.status"),
        t("operations.contracts.export.signing"),
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
        row.signingState ? t(signingStateLabels[row.signingState]) : "",
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
        // Past the row limit the file stops; the register page warns first.
        "x-contract-export-truncated": String(truncated),
      },
    });
  } catch (error) {
    return jsonFailure(error);
  }
}
