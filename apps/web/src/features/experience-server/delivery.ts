import "server-only";

import { getCommerceSession } from "@/src/auth/session";
import { getLocale } from "@/src/i18n/server";

import type { ProjectedArtifact } from "./artifact-delivery-list";
import {
  artifactKinds,
  ExperienceProblem,
  type ArtifactKind,
  type ExperienceAudience,
  type ProjectionChannel,
} from "./model";
import { configuredProjectionSource } from "./projection-source";

/**
 * The generated documents attached to one projection row.
 *
 * `ProjectionDetailPage` reads the same `data.artifacts` array off the record
 * it already holds. A record detail surface that is handed a presentation
 * record rather than a projection row has no such array -- `commercialRecord`
 * in `portal-view-loader` does not carry one -- so this reads the row again,
 * through the configured projection source, under the caller's own session and
 * account scope. That is the same `find` the surface's own loader made, with
 * the same authorization: no surface learns anything here it could not already
 * read.
 *
 * Absence -- and only absence -- resolves to no documents, and the list says
 * so in words rather than implying a download that is not there. The rule is
 * `isProjectionAbsent` in `portal-view-loader.ts`, written for the sibling read
 * on this same path, and it is deliberately narrow: the projection lookup
 * filters on `audience_account_id` and the `experience_projection_read` policy
 * repeats the same test, so a row belonging to another account produces no row
 * exactly as a row that was never written does. Both are `PROJECTION_NOT_FOUND`
 * and collapsing them is what keeps them one outcome.
 *
 * Nothing else is absence. A 401, 403, 409, 410, 422, 502 or 503, and every
 * error that is not an `ExperienceProblem` at all, propagates. The earlier
 * version of this function said that in a comment and did the opposite: it
 * logged only non-`ExperienceProblem` errors and returned `[]` for all of
 * them, so a 403 from the projection source rendered "No generated artifacts
 * are attached to this record" -- a false statement about a customer's own
 * agreements and invoices, with nothing anywhere to contradict it.
 *
 * Propagating costs the record body. `CommercialRecordDetail` awaits this
 * inline, so a throw is caught by the segment's `error.tsx` -- for all six
 * commercial channels that is `CommercialErrorState`, a branded card with a
 * retry that renders inside `AppShell`, so the reader keeps the navigation,
 * the organization switcher and a way back. That is a real cost and it is
 * taken deliberately, for three reasons. The reader has already been told a
 * falsehood is worse than being told to retry, and these are legal documents.
 * The blast radius is small: the caller reached this line only because
 * `loadCommercialRecord` had already completed the identical `find` -- same
 * session, audience, channel, account and record key -- so a 401 or 403 here
 * is a race or a defect rather than the ordinary case, and a 502 or 503 from
 * the source would have denied the record read too. And the alternative that
 * would be better than either -- a third `ProjectedArtifact` list state that
 * lets the panel say "documents could not be loaded" while the record renders
 * -- cannot be reached from this file: it needs the `state` union in
 * `artifact-delivery-list.tsx` and the call site in `record-detail.tsx`, both
 * outside this change. That is the follow-up, not a reason to keep lying.
 */
export async function loadRecordArtifacts(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  recordKey: string,
): Promise<readonly ProjectedArtifact[]> {
  try {
    const session = await getCommerceSession();
    const record = await configuredProjectionSource().find({
      session,
      audience,
      channel,
      accountId:
        audience === "internal"
          ? null
          : (session.impersonation?.accountId ??
            session.selectedAccountId ??
            session.accountIds[0] ??
            null),
      recordKey,
      now: new Date(),
      // The demo source resolves demo-authored text (artifact labels among
      // it) for the reader; without the language it resolves to English.
      locale: await getLocale(),
    });
    return projectedArtifacts(record.data.artifacts);
  } catch (error) {
    if (isProjectionAbsent(error)) return [];
    // Reported before it is rethrown, on the render-boundary precedent: the
    // error boundary above receives a digest, not a cause, so this is the only
    // place the cause and the record it happened on are both still in hand.
    console.error("Record artifact read failed", {
      audience,
      channel,
      recordKey,
      code: error instanceof ExperienceProblem ? error.code : "UNEXPECTED",
      status: error instanceof ExperienceProblem ? error.status : undefined,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { name: "UnknownError", message: String(error) },
    });
    throw error;
  }
}

/**
 * The one failure this read is allowed to turn into an absence.
 *
 * Deliberately identical to `isProjectionAbsent` in `portal-view-loader.ts`,
 * which governs the record read this artifact read follows. Two functions on
 * one read path with two rules is how the empty-list defect survived review;
 * the rule is stated in that file and this one applies it unchanged.
 */
function isProjectionAbsent(error: unknown): boolean {
  return error instanceof ExperienceProblem && error.status === 404;
}

/**
 * The same validation `ProjectionDetailPage` applies, for the same reason: the
 * projection payload is `jsonb`, so every field is a claim until it is checked,
 * and an entry that fails any check is dropped rather than rendered as a link
 * to an artifact route that would refuse it.
 */
function projectedArtifacts(value: unknown): readonly ProjectedArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const { kind, id, label, state } = item;
    if (
      typeof kind !== "string" ||
      !artifactKinds.includes(kind as ArtifactKind) ||
      typeof id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(id) ||
      typeof label !== "string" ||
      !label.trim() ||
      (state !== "stored" && state !== "pending" && state !== "missing")
    )
      return [];
    return [{ kind: kind as ArtifactKind, id, label, state }];
  });
}
