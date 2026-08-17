/** Commercial quote and order evidence is retained for the same policy term. */
export const ARTIFACT_RETENTION_YEARS = 7;

/**
 * Adds the documentary retention term in UTC so month and date cannot move
 * when a browser and server run in different time zones.
 */
export function commercialArtifactRetainUntil(issuedAt: string): string {
  const retention = new Date(issuedAt);
  retention.setUTCFullYear(
    retention.getUTCFullYear() + ARTIFACT_RETENTION_YEARS,
  );
  return retention.toISOString();
}
