import { ZodError, z } from "zod";
import { renderIndicativePricingSummary } from "@clockwork/documents";
import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { contractReader } from "@/src/features/internal-ops/contracts/demo-access";
import {
  jsonFailure,
  pdfResponse,
  withDocumentSlot,
} from "@/src/features/internal-ops/contracts/http";
import { contractActor } from "@/src/features/internal-ops/contracts/server";
import { demoPricingScenarios } from "@/src/features/internal-ops/sales-pricing/demo-scenarios";
import { summaryNames } from "@/src/features/internal-ops/sales-pricing/presentation";
import {
  demoScenarioBooks,
  scenarioRepository,
  scenarioScope,
} from "@/src/features/internal-ops/sales-pricing/scenario-server";
import { getLocale, getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Downloads a saved scenario as an indicative pricing summary and audits it.
 * `?audience=partner` adds the partner's earnings when the scenario has
 * partner inputs; any other value is the customer summary, list pricing
 * only. The PDF is rendered from the saved list-price lines; totals are
 * worked out again from them, and no floor, transfer price or code is read on
 * this path. In the guided demo it renders the fictional examples and
 * records nothing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await contractReader("sales:read");
    const id = z.uuid().parse((await params).id);
    const demo = explicitDemoIdentityEnabled();
    const repository = demo ? null : scenarioRepository();
    const scenario = repository
      ? await repository.get(id, scenarioScope(session))
      : await demoScenarioBooks(await getLocale()).then((read) =>
          demoPricingScenarios(read.books, read.readAt.slice(0, 10)).find(
            (example) => example.id === id,
          ),
        );
    if (!scenario) throw new Error("PRICING_SCENARIO_NOT_FOUND");
    const audience =
      new URL(request.url).searchParams.get("audience") === "partner" &&
      scenario.partnerEconomics
        ? "partner"
        : "customer";
    const t = await getTranslations();
    const pdf = await withDocumentSlot(() =>
      renderIndicativePricingSummary({
        scenarioId: scenario.id,
        company: scenario.company,
        asOf: scenario.asOf,
        lines: scenario.lines,
        ...summaryNames(scenario.lines, t),
        audience,
        partnerEconomics: scenario.partnerEconomics,
      }),
    ).catch((error: unknown) => {
      // A link download saves whatever comes back, so a row that cannot be
      // drawn answers with one readable sentence rather than a JSON body.
      if (
        error instanceof ZodError ||
        (error instanceof Error && error.message.startsWith("PRICING_SUMMARY_"))
      )
        return new Response(
          t("operations.sales.pricing.scenario.error.unprintable"),
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
    await repository?.recordDownload(
      contractActor(session),
      scenario.id,
      audience,
    );
    return pdfResponse(
      pdf.bytes,
      `Indicative pricing ${scenario.company} ${scenario.asOf}${audience === "partner" ? " partner" : ""}.pdf`,
      "attachment",
    );
  } catch (error) {
    return jsonFailure(error);
  }
}
