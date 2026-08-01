import { createHash } from "node:crypto";

const VOLATILE_REPORT_KEYS = new Set([
  "duration",
  "startTime",
  "endTime",
  "workerIndex",
  "parallelIndex",
]);

const RUNTIME_TIMESTAMP_PATTERN =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const ISOLATED_ORIGIN_PATTERN = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g;

export function normalizeArtifactText(value, roots) {
  let normalized = value;
  for (const [root, token] of roots)
    normalized = normalized.replaceAll(root, token);
  return normalized.replace(
    ISOLATED_ORIGIN_PATTERN,
    "<isolated-runtime-origin>",
  );
}

export function normalizeReportValue(value, roots, key = "") {
  if (VOLATILE_REPORT_KEYS.has(key)) return "<runtime-value>";
  if (Array.isArray(value))
    return value.map((item) => normalizeReportValue(item, roots));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        normalizeReportValue(child, roots, childKey),
      ]),
    );
  if (typeof value !== "string") return value;
  return normalizeArtifactText(value, roots).replace(
    RUNTIME_TIMESTAMP_PATTERN,
    "<runtime-timestamp>",
  );
}

export function semanticArtifactInventoryFingerprint(entries) {
  const semanticEntries = entries.map(
    ({ path, semanticSha256, normalization }) => ({
      path,
      semanticSha256,
      normalization,
    }),
  );
  return createHash("sha256")
    .update(JSON.stringify(semanticEntries))
    .digest("hex");
}
