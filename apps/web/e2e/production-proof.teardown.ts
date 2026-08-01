import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FullConfig } from "@playwright/test";

import { createDirectMigrationClient } from "@clockwork/db/migration-client";

import { proofIdentities } from "./production-proof.setup";

export default async function productionProofTeardown(_config: FullConfig) {
  const databaseUrl = process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      "DIRECT_DATABASE_URL is required for release proof teardown",
    );
  const artifactRoot = path.resolve(
    process.env.CLOCKWORK_ARTIFACT_DIR ?? "test-results/proof",
  );
  const stateRoot = path.join(artifactRoot, "auth");
  const sql = createDirectMigrationClient(databaseUrl);
  const revokedAt = new Date().toISOString();
  try {
    for (const identity of proofIdentities) {
      await sql`
        update public.experience_release_proof_sessions
        set revoked_at = ${revokedAt}::timestamptz
        where id = ${identity.sessionId}::uuid
      `;
    }
  } finally {
    try {
      await sql.end();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  }
  await writeFile(
    path.join(artifactRoot, "proof-auth-lifecycle.json"),
    `${JSON.stringify(
      {
        activeSessionCount: 0,
        revokedSessionCount: proofIdentities.length,
        revokedAt,
        cookieMaterialRetained: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
