import { and, eq, sql } from "drizzle-orm";
import type { RuntimeDatabase } from "../../client";
import { commerceUsers } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

export interface MfaSessionBinding {
  sessionId: string;
  workosUserId: string;
  workosOrganizationId: string;
}

/**
 * Called only after the server confirms hosted MFA for this exact session.
 * Synchronizes enrollment without manufacturing a challenge receipt, current
 * token factor, or recent-authentication evidence.
 */
export async function recordHostedMfaEnrollment(
  db: RuntimeDatabase,
  input: MfaSessionBinding & { commerceUserId: string; factorId: string },
): Promise<boolean> {
  if (!input.sessionId) throw new Error("HOSTED_MFA_SESSION_REQUIRED");
  if (!input.factorId) return false;
  const requestId = `hosted-mfa-enrollment:${input.sessionId}`;
  return withInternalTransaction(db, requestId, async (tx) => {
    // Serialize with receipt-based factor changes and token issuance. A
    // changed authenticator must complete the real local challenge so the
    // receipt can revoke tokens issued for the old factor.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`access_tokens:${input.commerceUserId}`}, 0))`,
    );
    // Memberships are deleted on deactivation. Enrollment records a user-level
    // fact; it never creates or restores membership or grants authorization.
    const bindings = await tx.execute<{
      access_token_mfa_factor_id: string | null;
    }>(sql`
      select person.access_token_mfa_factor_id from public.memberships membership
      join public.commerce_users person on person.id = membership.user_id
      join public.organizations organization on organization.id = membership.organization_id
      where person.id = ${input.commerceUserId}::uuid
        and person.workos_user_id = ${input.workosUserId}
        and organization.workos_organization_id = ${input.workosOrganizationId}
    `);
    if (bindings.length !== 1)
      throw new Error("HOSTED_MFA_MEMBERSHIP_REQUIRED");
    const currentFactor = bindings[0]?.access_token_mfa_factor_id;
    if (currentFactor && currentFactor !== input.factorId) return false;
    const [enrolled] = await tx
      .update(commerceUsers)
      .set({ mfaEnrolled: true })
      .where(
        and(
          eq(commerceUsers.id, input.commerceUserId),
          eq(commerceUsers.workosUserId, input.workosUserId),
          eq(commerceUsers.mfaEnrolled, false),
        ),
      )
      .returning({
        id: commerceUsers.id,
        rowVersion: commerceUsers.rowVersion,
      });
    if (!enrolled) return true;
    await appendAuditAndOutbox(tx, {
      aggregateType: "user",
      aggregateId: enrolled.id,
      aggregateVersion: enrolled.rowVersion,
      eventType: "identity.mfa_enrolled",
      actor: { kind: "user", id: enrolled.id },
      requestId,
      before: { mfaEnrolled: false },
      after: { mfaEnrolled: true },
      metadata: {
        source: "workos_hosted_session",
        sessionId: input.sessionId,
        workosUserId: input.workosUserId,
        workosOrganizationId: input.workosOrganizationId,
      },
    });
    return true;
  });
}

/** An atomic per-user budget survives concurrent requests and new login sessions. */
export async function claimMfaAttempt(
  db: RuntimeDatabase,
  workosUserId: string,
): Promise<boolean> {
  return claimMfaBudget(db, workosUserId);
}

/** Preparation has its own fixed budget and cannot spend or reset code attempts. */
export async function claimMfaPreparationAttempt(
  db: RuntimeDatabase,
  workosUserId: string,
): Promise<boolean> {
  // Provider user IDs start with user_, so this internal namespace cannot
  // overlap the existing verification keys. Callers cannot choose a purpose.
  return claimMfaBudget(db, `mfa-prepare:${workosUserId}`);
}

async function claimMfaBudget(
  db: RuntimeDatabase,
  key: string,
): Promise<boolean> {
  const rows = await db.execute<{ attempts: number }>(sql`
    insert into public.experience_mfa_attempts(workos_user_id, window_started_at, attempts)
    values (${key}, now(), 1)
    on conflict (workos_user_id) do update set
      window_started_at = case when experience_mfa_attempts.window_started_at <= now() - interval '10 minutes' then now() else experience_mfa_attempts.window_started_at end,
      attempts = case when experience_mfa_attempts.window_started_at <= now() - interval '10 minutes' then 1 else experience_mfa_attempts.attempts + 1 end
    where experience_mfa_attempts.window_started_at <= now() - interval '10 minutes'
       or experience_mfa_attempts.attempts < 5
    returning attempts
  `);
  return rows.length === 1;
}

export async function recordMfaReceipt(
  db: RuntimeDatabase,
  input: MfaSessionBinding & { challengeId: string; factorId: string },
) {
  await withInternalTransaction(
    db,
    `mfa-receipt:${input.challengeId}`,
    async (tx) => {
      const [person] = await tx
        .select({ id: commerceUsers.id })
        .from(commerceUsers)
        .where(eq(commerceUsers.workosUserId, input.workosUserId));
      // The enrollment trigger takes the user row lock before the later
      // factor-change trigger requests this advisory lock. Take it first here
      // to keep the same order as hosted synchronization and token issuance.
      if (person)
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`access_tokens:${person.id}`}, 0))`,
        );
      await tx.execute(sql`
      insert into public.experience_mfa_receipts
        (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
      values (${input.challengeId}, ${input.sessionId}, ${input.workosUserId}, ${input.workosOrganizationId}, ${input.factorId})
    `);
    },
  );
}

export async function findMfaReceipt(
  db: RuntimeDatabase,
  input: MfaSessionBinding,
) {
  const [receipt] = await db.execute<{ verified_at: Date | string }>(sql`
    select verified_at from public.experience_mfa_receipts
    where session_id = ${input.sessionId} and workos_user_id = ${input.workosUserId}
      and workos_organization_id = ${input.workosOrganizationId}
      and verified_at <= now() and expires_at > now()
    order by verified_at desc limit 1
  `);
  return receipt ? new Date(receipt.verified_at).getTime() : undefined;
}
