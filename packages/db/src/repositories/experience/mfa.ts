import { sql } from "drizzle-orm";
import type { RuntimeDatabase } from "../../client";

export interface MfaSessionBinding {
  sessionId: string;
  workosUserId: string;
  workosOrganizationId: string;
}

/** An atomic per-user budget survives concurrent requests and new login sessions. */
export async function claimMfaAttempt(
  db: RuntimeDatabase,
  workosUserId: string,
) {
  const rows = await db.execute<{ attempts: number }>(sql`
    insert into public.experience_mfa_attempts(workos_user_id, window_started_at, attempts)
    values (${workosUserId}, now(), 1)
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
  await db.execute(sql`
    insert into public.experience_mfa_receipts
      (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
    values (${input.challengeId}, ${input.sessionId}, ${input.workosUserId}, ${input.workosOrganizationId}, ${input.factorId})
  `);
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
