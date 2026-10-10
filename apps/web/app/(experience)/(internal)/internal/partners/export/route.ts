import { PartnerListQuerySchema } from "@clockwork/contracts";

import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { toCsv } from "@/src/features/internal-ops/contracts/csv";
import { contractReader } from "@/src/features/internal-ops/contracts/demo-access";
import { jsonFailure } from "@/src/features/internal-ops/contracts/http";
import { contractActor } from "@/src/features/internal-ops/contracts/server";
import {
  partnerExclusivityLabels,
  partnerModelLabels,
  partnerStatusLabels,
} from "@/src/features/internal-ops/partners/model";
import {
  partnerReader,
  partnerRepository,
  partnerToday,
} from "@/src/features/internal-ops/partners/server";
import { getTranslations } from "@/src/i18n/server";

/**
 * The partner list as CSV, with the same filters as the list on screen
 * (`sales:read`). Every export is audited with its filters and row count
 * before the file is sent.
 */
export async function GET(request: Request) {
  try {
    const session = await contractReader("sales:read");
    const t = await getTranslations();
    const today = partnerToday();
    const query = PartnerListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const { rows, truncated } = await partnerReader(session).exportRows(query, {
      viewerId: session.userId,
      today,
    });
    // The demo records are fictional and have no audit trail to write to.
    if (!explicitDemoIdentityEnabled())
      await partnerRepository().recordExport(contractActor(session), {
        filters: query,
        rows: rows.length,
        truncated,
      });
    const csv = toCsv(
      [
        t("operations.partners.column.partner"),
        t("operations.partners.column.status"),
        t("operations.partners.column.models"),
        t("operations.partners.column.owner"),
        t("operations.partners.export.region"),
        t("operations.partners.export.website"),
        t("operations.partners.export.commission"),
        t("operations.partners.export.schedule"),
        t("operations.partners.export.margin"),
        t("operations.partners.export.currency"),
        t("operations.partners.export.territory"),
        t("operations.partners.export.exclusivity"),
        t("operations.partners.export.nfr"),
        t("operations.partners.export.trial"),
        t("operations.partners.column.nextStep"),
        t("operations.partners.export.nextStepDue"),
        t("operations.partners.column.openDeals"),
        t("operations.partners.export.updated"),
      ],
      rows.map((row) => [
        row.name,
        t(partnerStatusLabels[row.status]),
        row.models.map((model) => t(partnerModelLabels[model])).join("; "),
        row.ownerName ?? "",
        row.region,
        row.website,
        row.commissionPct,
        row.terms?.commissionSchedule ?? "",
        row.marginPct,
        row.currency ?? "",
        row.terms?.territory ?? "",
        row.terms?.exclusivity
          ? t(partnerExclusivityLabels[row.terms.exclusivity])
          : "",
        row.terms?.nfrAllowance ?? "",
        row.terms?.trialPeriod ?? "",
        row.nextStep,
        row.nextStepDue,
        row.openDeals,
        row.updatedAt.slice(0, 10),
      ]),
    );
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="fil-one-partners-${today}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-partner-export-truncated": String(truncated),
      },
    });
  } catch (error) {
    return jsonFailure(error);
  }
}
