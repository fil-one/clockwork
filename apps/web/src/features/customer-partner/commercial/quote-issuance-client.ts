import type {
  BuyQuoteProjectionLookup,
  PreparedQuoteArtifactLookup,
} from "./prepared-quote-artifact";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function preparedArtifactRequestId(result: unknown): string | null {
  const data = record(record(result)?.record)?.data;
  const dataRecord = record(data);
  const production = record(dataRecord?.artifactRequest)?.requestId;
  const demo = dataRecord?.artifactRequestId;
  const candidate = typeof production === "string" ? production : demo;
  return typeof candidate === "string" && uuidPattern.test(candidate)
    ? candidate
    : null;
}

export async function readPreparedQuoteArtifact(input: {
  artifactRequestId: string;
  quoteId: string;
  accountId: string;
}): Promise<PreparedQuoteArtifactLookup> {
  const response = await fetch(
    `/api/experience/artifacts/direct_quote/${encodeURIComponent(input.artifactRequestId)}?representation=json`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 404) return { status: "pending" };
  if (response.status === 401 || response.status === 403)
    return { status: "forbidden" };
  if (response.status === 503) return { status: "unavailable" };
  if (!response.ok) throw new Error("The quote document lookup failed");
  const artifact = record(await response.json().catch(() => null));
  if (
    artifact?.kind !== "direct_quote" ||
    artifact.subjectType !== "quote" ||
    artifact.id !== input.artifactRequestId ||
    artifact.subjectId !== input.quoteId ||
    artifact.accountId !== input.accountId ||
    typeof artifact.documentId !== "string" ||
    !uuidPattern.test(artifact.documentId)
  )
    return { status: "unavailable" };
  return {
    status: "stored",
    documentId: artifact.documentId,
    artifactId: input.artifactRequestId,
  };
}

export async function readBuyQuoteProjection(input: {
  quoteId: string;
  accountId: string;
}): Promise<BuyQuoteProjectionLookup> {
  const recordKey = `quote-${input.quoteId}`;
  const response = await fetch(
    `/api/experience/projections/customer/quotes/${encodeURIComponent(recordKey)}`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    },
  );
  if (response.status === 404) return { status: "pending" };
  if (response.status === 401 || response.status === 403)
    return { status: "forbidden" };
  if (response.status === 503) return { status: "unavailable" };
  if (!response.ok) throw new Error("The quote projection lookup failed");
  const projection = record(await response.json().catch(() => null));
  const authoritative = record(record(projection?.data)?.authoritative);
  if (
    projection?.recordKey !== recordKey ||
    projection.aggregateType !== "quote" ||
    projection.aggregateId !== input.quoteId ||
    projection.accountId !== input.accountId ||
    projection.audience !== "customer" ||
    projection.channel !== "quotes" ||
    projection.stale !== false ||
    !Number.isInteger(projection.version) ||
    Number(projection.version) < 1 ||
    typeof authoritative?.status !== "string"
  )
    return { status: "unavailable" };
  return {
    status: "found",
    quoteStatus: authoritative.status,
    rowVersion: Number(projection.version),
    marginResult:
      typeof authoritative.marginFloorResult === "string"
        ? authoritative.marginFloorResult
        : undefined,
  };
}
