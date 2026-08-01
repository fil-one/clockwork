import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "@clockwork/db";

import { releaseProofNonceHash } from "./release-proof";
import { resolveReleaseProofIdentity } from "./release-proof-repository";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const proofSessionId = "12000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000008";
const nonce = "0123456789abcdef0123456789abcdef";
const expiresAt = "2030-07-31T16:15:00.000Z";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});

async function cleanup() {
  await db.execute(sql`
    delete from public.experience_release_proof_sessions
    where id = ${proofSessionId}::uuid
  `);
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await client.end();
});

describe.sequential("release-proof repository authorization", () => {
  it("requires the exact durable nonce and expiry and rejects revocation", async () => {
    await db.execute(sql`
      insert into public.experience_release_proof_sessions (
        id, user_id, organization_id, nonce_hash, expires_at,
        mfa_verified, recent_authentication_verified
      ) values (
        ${proofSessionId}::uuid, ${userId}::uuid, ${organizationId}::uuid,
        ${releaseProofNonceHash(nonce)}, ${expiresAt}::timestamptz, true, true
      )
    `);
    const payload = { sessionId: proofSessionId, expiresAt, nonce };

    await expect(
      resolveReleaseProofIdentity(db, {
        payload,
        requestId: "release-proof:authorized",
        now: new Date("2030-07-31T16:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      sessionId: proofSessionId,
      selected: { userId, organizationId },
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });

    await expect(
      resolveReleaseProofIdentity(db, {
        payload: { ...payload, nonce: "fedcba9876543210fedcba9876543210" },
        requestId: "release-proof:altered-nonce",
        now: new Date("2030-07-31T16:00:00.000Z"),
      }),
    ).rejects.toThrow("Release-proof session is not authorized");
    await expect(
      resolveReleaseProofIdentity(db, {
        payload: {
          ...payload,
          expiresAt: "2030-07-31T16:14:59.000Z",
        },
        requestId: "release-proof:altered-expiry",
        now: new Date("2030-07-31T16:00:00.000Z"),
      }),
    ).rejects.toThrow("Release-proof session is not authorized");

    await db.execute(sql`
      update public.experience_release_proof_sessions
      set revoked_at = '2030-07-31T16:01:00.000Z'::timestamptz
      where id = ${proofSessionId}::uuid
    `);
    await expect(
      resolveReleaseProofIdentity(db, {
        payload,
        requestId: "release-proof:revoked",
        now: new Date("2030-07-31T16:02:00.000Z"),
      }),
    ).rejects.toThrow("Release-proof session is not authorized");
  });
});
