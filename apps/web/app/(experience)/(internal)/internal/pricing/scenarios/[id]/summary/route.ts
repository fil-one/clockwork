import { ZodError, z } from "zod";
import { renderIndicativePricingSummary } from "@clockwork/documents";
import {
  jsonFailure,
  pdfResponse,
  withDocumentSlot,
} from "@/src/features/internal-ops/contracts/http";
import {
  contractActor,
  contractStaff,
} from "@/src/features/internal-ops/contracts/server";
import {
  scenarioRepository,
  scenarioScope,
} from "@/src/features/internal-ops/sales-pricing/scenario-server";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Downloads a saved scenario as an indicative pricing summary and audits it.
 * The PDF is rendered from the saved list-price lines; totals are worked out
 * again from them, and no floor, transfer price or code is read on this path.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await contractStaff("sales:read");
    const id = z.uuid().parse((await params).id);
    const repository = scenarioRepository();
    const scenario = await repository.get(id, scenarioScope(session));
    const pdf = await withDocumentSlot(() =>
      renderIndicativePricingSummary({
        scenarioId: scenario.id,
        company: scenario.company,
        asOf: scenario.asOf,
        lines: scenario.lines,
      }),
    ).catch(async (error: unknown) => {
      // A link download saves whatever comes back, so a row that cannot be
      // drawn answers with one readable sentence rather than a JSON body.
      if (
        error instanceof ZodError ||
        (error instanceof Error && error.message.startsWith("PRICING_SUMMARY_"))
      )
        return new Response(
          (await getTranslations())(
            "operations.sales.pricing.scenario.error.unprintable",
          ),
          {
            status: 422,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      throw error;
    });
    if (pdf instanceof Response) return pdf;
    await repository.recordDownload(contractActor(session), scenario.id);
    return pdfResponse(
      pdf.bytes,
      `Indicative pricing ${scenario.company} ${scenario.asOf}.pdf`,
      "attachment",
    );
  } catch (error) {
    return jsonFailure(error);
  }
}
