import type { ProjectionRecord } from "@/src/features/experience-server/model";
import type { AcceptableQuote } from "@/src/features/customer-partner/commercial/order-acceptance";
import { projectionDisplay } from "@/src/features/customer-partner/commercial/record-presentation";
import type { Translator } from "@/src/i18n";

type Data = Readonly<Record<string, unknown>>;

function text(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function object(data: Data, key: string): Data {
  const value = data[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function quoteRevision(record: ProjectionRecord): string {
  const revision = object(record.data, "authoritative").revision;
  if (typeof revision === "number" && Number.isInteger(revision))
    return String(revision);
  if (typeof revision === "string" && revision.trim()) return revision.trim();
  return text(record.data, "version") ?? String(record.version);
}

/**
 * Maps projection identity to the commercial identity shown to the signer,
 * in the signer's language: a quote carrying facts is rendered from them, and
 * one carrying only display strings shows them as written.
 */
export function toAcceptableQuote(
  record: ProjectionRecord,
  t: Translator,
  locale: string,
): AcceptableQuote {
  const data = record.data;
  const display = projectionDisplay(
    data,
    "quotes",
    record.sourceUpdatedAt,
    t,
    locale,
  );
  return {
    id: record.aggregateId,
    reference: text(data, "reference") ?? record.recordKey,
    title: text(data, "title") ?? record.recordKey,
    version: quoteRevision(record),
    scope:
      display.description.trim() ||
      t("customer.commercial.review.scopeNotRecorded"),
    spend: display.value.trim() || t("customer.commercial.review.notPriced"),
    acceptedLabel:
      display.timing.trim() ||
      t("customer.commercial.review.acceptanceNotRecorded"),
  };
}

/**
 * The quote whose acceptance ceremony may be opened.
 *
 * Authoritative quote acceptance only permits an issued quote. Customer
 * projections present that state as `open`, while `issued` remains accepted
 * here for projection compatibility. An accepted quote already has an order
 * and must never be sent through the ceremony a second time.
 *
 * An explicit record key is a binding, not a hint: when it names a quote in
 * any other state, no quote is selected. In particular, the selector must not
 * fall back to a different open quote and ask the reader to attest to that.
 */
export function selectAcceptanceQuote(
  records: readonly ProjectionRecord[],
  requested: string | undefined,
): ProjectionRecord | undefined {
  const acceptable = (record: ProjectionRecord) => {
    const status = text(record.data, "status");
    return status === "issued" || status === "open";
  };
  return requested
    ? records.find(
        (record) => record.recordKey === requested && acceptable(record),
      )
    : records.find(acceptable);
}
