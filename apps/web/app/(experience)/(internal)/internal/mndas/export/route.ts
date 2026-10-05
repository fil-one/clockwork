import { parseMndaRegisterParams } from "@clockwork/contracts";
import { getTranslations } from "@/src/i18n/server";
import { mndaStateLabels } from "@/src/features/internal-ops/mnda/labels";
import {
  mndaActor,
  mndaRepository,
  mndaStaff,
  type MndaSession,
} from "@/src/features/internal-ops/mnda/server";
import {
  contentDisposition,
  mndaRegisterCsv,
} from "@/src/features/internal-ops/mnda/register";

export const dynamic = "force-dynamic";

/**
 * CSV of the register with the page's filters (`status`, `mine`, `q`). Every
 * export is audited with its filters and row count. Past the row cap the
 * response says so in `x-mnda-export-truncated`; the page warns beforehand.
 */
export async function GET(request: Request) {
  let session: MndaSession;
  try {
    session = await mndaStaff();
  } catch {
    return new Response(null, { status: 403 });
  }
  const t = await getTranslations();
  try {
    const query = parseMndaRegisterParams(new URL(request.url).searchParams);
    const repository = mndaRepository();
    const { records, truncated } = await repository.exportRows(
      query,
      session.userId,
    );
    await repository.recordAccess(mndaActor(session), {
      kind: "export",
      filters: { ...query, page: 1 },
      rows: records.length,
      truncated,
    });
    const today = new Date().toISOString().slice(0, 10);
    // Status words follow the reader's language; the status code column next
    // to them stays stable for spreadsheet and CRM imports.
    return new Response(
      mndaRegisterCsv(records, {
        status: (r) => t(mndaStateLabels[r.state]),
        signerChange: t("operations.mnda.void.someoneElseReason"),
      }),
      {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": contentDisposition(
            `Fil-One-MNDA-register_${today}.csv`,
          ),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "x-mnda-export-truncated": String(truncated),
        },
      },
    );
  } catch {
    return new Response(t("operations.mnda.exportFailed"), {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
