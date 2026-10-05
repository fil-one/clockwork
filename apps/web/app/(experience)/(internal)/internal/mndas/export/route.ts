import { parseMndaRegisterParams } from "@clockwork/contracts";
import { getTranslations } from "@/src/i18n/server";
import { mndaStateLabels } from "@/src/features/internal-ops/mnda/labels";
import {
  mndaRepository,
  mndaStaff,
  type MndaSession,
} from "@/src/features/internal-ops/mnda/server";
import {
  contentDisposition,
  mndaRegisterCsv,
} from "@/src/features/internal-ops/mnda/register";

export const dynamic = "force-dynamic";

/** CSV of the register with the page's filters (`status`, `mine`, `q`). */
export async function GET(request: Request) {
  let session: MndaSession;
  try {
    session = await mndaStaff();
  } catch {
    return new Response(null, { status: 403 });
  }
  const query = parseMndaRegisterParams(new URL(request.url).searchParams);
  const records = await mndaRepository().exportRows(query, session.userId);
  // Status words follow the reader's language; the status code column next to
  // them stays stable for spreadsheet and CRM imports.
  const t = await getTranslations();
  const today = new Date().toISOString().slice(0, 10);
  return new Response(
    mndaRegisterCsv(records, (r) => t(mndaStateLabels[r.state])),
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": contentDisposition(
          `Fil-One-MNDA-register_${today}.csv`,
        ),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
