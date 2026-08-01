import "server-only";

import { sql } from "drizzle-orm";

import type { RuntimeDatabase } from "@clockwork/db";
import { withInternalTransaction } from "@clockwork/db";

import {
  listAuthorizedMemberships,
  selectedMembership,
  type AuthorizedMembership,
} from "./identity-repository";
import {
  releaseProofNonceHash,
  type ReleaseProofPayload,
} from "./release-proof";

interface ProofSessionRow extends Record<string, unknown> {
  workos_user_id: string;
  workos_organization_id: string;
  expires_at: Date;
  mfa_verified: boolean;
  recent_authentication_verified: boolean;
}

export interface ReleaseProofIdentity {
  sessionId: string;
  selected: AuthorizedMembership;
  memberships: readonly AuthorizedMembership[];
  mfaVerified: boolean;
  recentAuthenticationVerified: boolean;
}

export async function resolveReleaseProofIdentity(
  db: RuntimeDatabase,
  input: { payload: ReleaseProofPayload; requestId: string; now?: Date },
): Promise<ReleaseProofIdentity> {
  const now = input.now ?? new Date();
  const rows = await withInternalTransaction(
    db,
    input.requestId,
    (transaction) =>
      transaction.execute<ProofSessionRow>(sql`
        select u.workos_user_id,
               o.workos_organization_id,
               p.expires_at,
               p.mfa_verified,
               p.recent_authentication_verified
        from public.experience_release_proof_sessions p
        join public.commerce_users u on u.id = p.user_id
        join public.organizations o on o.id = p.organization_id
        join public.memberships m
          on m.user_id = p.user_id and m.organization_id = p.organization_id
        where p.id = ${input.payload.sessionId}::uuid
          and p.nonce_hash = ${releaseProofNonceHash(input.payload.nonce)}
          and p.expires_at = ${input.payload.expiresAt}::timestamptz
          and p.expires_at > ${now.toISOString()}::timestamptz
          and p.revoked_at is null
          and o.workos_organization_id is not null
      `),
  );
  const proof = rows[0];
  if (!proof) throw new Error("Release-proof session is not authorized");
  const memberships = await listAuthorizedMemberships(db, {
    workosUserId: proof.workos_user_id,
    requestId: `${input.requestId}:memberships`,
  });
  return {
    sessionId: input.payload.sessionId,
    selected: selectedMembership(memberships, proof.workos_organization_id),
    memberships,
    mfaVerified: proof.mfa_verified,
    recentAuthenticationVerified: proof.recent_authentication_verified,
  };
}
