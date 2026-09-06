import "server-only";

import type { SessionClaims } from "@clockwork/api";
import { uuidV7 } from "@clockwork/contracts";
import type { BillingInvoiceDerivation } from "@clockwork/db";

import { getCommerceSession } from "@/src/auth/session";

import { resolveScopedAccount } from "./authorization";
import { configuredExperienceRepository } from "./demo-experience-repository";
import { ExperienceProblem, type ExperienceAudience } from "./model";
import type { ExperienceRepository } from "./repository-port";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DerivationRequest {
  session: SessionClaims;
  audience: ExperienceAudience;
  /** Account named by the caller. Internal callers must leave this null. */
  requestedAccountId: string | null;
  /** Account the records belong to, taken from the surface the operator opened. */
  subjectAccountId: string;
  limit?: number;
}

export interface AccountDerivations {
  accountId: string;
  derivations: readonly BillingInvoiceDerivation[];
  generatedAt: string;
}

/**
 * The account whose invoices a caller may read.
 *
 * `resolveScopedAccount` already decides this: it rejects an audience the
 * session cannot use, pins a tenant caller to their own account, and refuses an
 * account parameter from an internal caller, whose visibility is carried by the
 * transaction instead. A tenant caller therefore reads only the account the
 * session resolved to, whatever account the surface names.
 */
export function derivationScope(request: DerivationRequest): string {
  const scoped = resolveScopedAccount(
    request.session,
    request.audience,
    request.requestedAccountId,
  );
  if (!UUID_PATTERN.test(request.subjectAccountId))
    throw new ExperienceProblem(
      422,
      "ACCOUNT_IDENTIFIER_INVALID",
      "Account identifier is invalid",
    );
  if (scoped && scoped !== request.subjectAccountId)
    throw new ExperienceProblem(
      403,
      "ACCOUNT_SCOPE_FORBIDDEN",
      "Account access denied",
    );
  return scoped ?? request.subjectAccountId;
}

/**
 * Reads the account identifier out of an `account-<uuid>` projection key, or
 * null when the key belongs to something other than an account.
 */
export function parseAccountId(recordKey: string): string | null {
  const candidate = recordKey.startsWith("account-")
    ? recordKey.slice("account-".length)
    : recordKey;
  return UUID_PATTERN.test(candidate) ? candidate : null;
}

export function accountIdFromRecordKey(recordKey: string): string {
  const accountId = parseAccountId(recordKey);
  if (!accountId)
    throw new ExperienceProblem(
      422,
      "ACCOUNT_IDENTIFIER_INVALID",
      "Account identifier is invalid",
    );
  return accountId;
}

export async function readAccountDerivations(
  request: DerivationRequest,
  repository: ExperienceRepository = configuredExperienceRepository(),
): Promise<AccountDerivations> {
  const accountId = derivationScope(request);
  const derivations = await repository.accountInvoiceDerivations(
    request.session,
    accountId,
    request.limit ?? 5,
    `derivation:${uuidV7()}`,
  );
  return {
    accountId,
    derivations,
    generatedAt: new Date().toISOString(),
  };
}

/** Server-component entry point for the internal account surface. */
export async function loadAccountDerivations(
  recordKey: string,
  limit = 5,
): Promise<AccountDerivations> {
  return readAccountDerivations({
    session: await getCommerceSession(),
    audience: "internal",
    requestedAccountId: null,
    subjectAccountId: accountIdFromRecordKey(recordKey),
    limit,
  });
}
