import type { Metadata } from "next";
import { getTranslations } from "@/src/i18n/server";
import { loadQuoteRevisionSource } from "@/src/features/experience-server/quote-revision-source";
import {
  QuoteBuilder,
  type QuoteOrigin,
} from "@/src/features/customer-partner/commercial/quote-builder";
import {
  firstSearchParam,
  parseQuotePrefill,
  type RawSearchParams,
} from "@/src/features/customer-partner/commercial/url-state";
import {
  loadCustomerQuoteOffers,
  loadPortalRecords,
} from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("customer.commercial.builder.title.create") };
}

async function resolveOrigin(
  revises: string | undefined,
  poc: string | undefined,
): Promise<QuoteOrigin | undefined> {
  if (revises) {
    const { records } = await loadPortalRecords("customer", "quotes");
    return {
      kind: "revision",
      reference: revises,
      resolved: records.some((record) => record.recordKey === revises),
    };
  }
  if (poc) {
    const { records } = await loadPortalRecords("customer", "pocs");
    return {
      kind: "poc",
      reference: poc,
      resolved: records.some((record) => record.recordKey === poc),
    };
  }
  return undefined;
}

async function QuoteWorkspace({ params }: { params: RawSearchParams }) {
  const [identity, originalOrigin, offerResult] = await Promise.all([
    getRouteIdentity("customer"),
    resolveOrigin(
      firstSearchParam(params, "revises"),
      firstSearchParam(params, "poc"),
    ),
    loadCustomerQuoteOffers(),
  ]);
  let origin = originalOrigin;
  let initialDraft: Parameters<typeof QuoteBuilder>[0]["initialDraft"] =
    parseQuotePrefill(params);
  let initialLines: Parameters<typeof QuoteBuilder>[0]["initialLines"] = [];
  let offers = offerResult.status === "available" ? offerResult.offers : [];
  if (origin?.kind === "revision") {
    const source = await loadQuoteRevisionSource(origin.reference);
    const line = source?.lines?.[0];
    const matchedLines = source?.lines?.map((line) => ({
      line,
      offer: offers.find(
        (candidate) =>
          candidate.priceBookId === source.priceBookId &&
          candidate.sku === line.sku &&
          candidate.region === line.region,
      ),
    }));
    const offer = offers.find(
      (candidate) =>
        candidate.priceBookId === source?.priceBookId &&
        candidate.sku === line?.sku &&
        candidate.region === line?.region,
    );
    if (
      source &&
      source?.seriesId &&
      source.priceBookId &&
      line &&
      offer &&
      matchedLines?.every((item) => item.offer) &&
      ["issued", "expired", "rejected"].includes(source.status ?? "")
    ) {
      origin = {
        ...origin,
        revision: {
          quoteId: source.quoteId,
          version: source.version,
          seriesId: source.seriesId,
          priceBookId: source.priceBookId,
        },
      };
      offers = offers.filter(
        (candidate) => candidate.priceBookId === source.priceBookId,
      );
      initialLines = matchedLines.slice(1).map(({ line, offer }) => {
        // i18n-exempt: unreachable invariant (every line's offer was matched above); the error boundary renders its own copy
        if (!offer) throw new Error("The original offer is unavailable.");
        return {
          offerId: offer.id,
          capacity: line.quantity,
          termMonths: String(line.termMonths),
        };
      });
      initialDraft = {
        capacity: line.quantity,
        termMonths: String(line.termMonths),
        offer: offer.label,
        region: line.region,
      };
    } else origin = { ...origin, resolved: false };
  }
  return (
    <QuoteBuilder
      account={{ id: identity.accountId, name: identity.accountName }}
      catalogueMode={
        offerResult.status === "available"
          ? offerResult.catalogueMode
          : "authoritative"
      }
      initialDraft={initialDraft}
      initialLines={initialLines}
      offers={offers}
      {...(origin ? { origin } : {})}
    />
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="quote:write">
      <QuoteWorkspace params={params} />
    </SurfacePermissionGate>
  );
}
