import { randomUUID } from "node:crypto";
import { and, eq, ne, notInArray, or, sql } from "drizzle-orm";
import type {
  SigningJourneyKind,
  SigningJourneySnapshot,
  SigningMailPurpose,
  SigningRecipient,
} from "@clockwork/contracts";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { mndaRequests } from "../schema/mnda";
import { contractSigning } from "../schema/contracts";
import { signingMail, signingRecipients } from "../schema/signing-journey";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

export interface SigningMailJob {
  id: string;
  recipientId: string;
  recipientNonce: string;
  purpose: SigningMailPurpose;
  attempts: number;
  leaseToken: string;
}

export interface SigningJourneyStore {
  synchronize(
    snapshot: SigningJourneySnapshot,
    reminderEvent?: string,
  ): Promise<void>;
  revoke(
    kind: SigningJourneyKind,
    requestId: string,
    sourceVersion: number,
  ): Promise<void>;
  recipient(id: string): Promise<SigningRecipient | null>;
  reserveProviderRead(id: string): Promise<boolean>;
  recordAccess(id: string, action: "opened" | "downloaded"): Promise<void>;
  claim(): Promise<SigningMailJob | null>;
  finish(
    job: SigningMailJob,
    state: "sent" | "skipped" | "failed" | "pending" | "deferred",
    code?: string,
  ): Promise<void>;
}

export class SigningJourneyRepository implements SigningJourneyStore {
  constructor(private readonly db: RuntimeDatabase) {}
  private tx<T>(operation: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), operation);
  }
  recipient(id: string): Promise<SigningRecipient | null> {
    return this.tx(
      async (tx) =>
        (
          await tx
            .select()
            .from(signingRecipients)
            .where(eq(signingRecipients.id, id))
            .limit(1)
        )[0] ?? null,
    );
  }
  reserveProviderRead(id: string) {
    return this.tx(async (tx) =>
      Boolean(
        (
          await tx
            .update(signingRecipients)
            .set({ providerReadAt: new Date() })
            .where(
              and(
                eq(signingRecipients.id, id),
                sql`(${signingRecipients.providerReadAt} is null or ${signingRecipients.providerReadAt} < now() - interval '10 seconds')`,
              ),
            )
            .returning({ id: signingRecipients.id })
        ).length,
      ),
    );
  }
  recordAccess(id: string, action: "opened" | "downloaded") {
    return this.tx(async (tx) => {
      await this.audit(tx, id, `signing.recipient_${action}`, {
        recipientId: id,
      });
    });
  }
  private async lockSource(
    tx: RuntimeTransaction,
    kind: SigningJourneyKind,
    id: string,
    version: number,
  ) {
    const rows =
      kind === "mnda"
        ? await tx
            .select({ version: mndaRequests.version })
            .from(mndaRequests)
            .where(eq(mndaRequests.id, id))
            .for("share")
        : await tx
            .select({ version: contractSigning.version })
            .from(contractSigning)
            .where(eq(contractSigning.contractId, id))
            .for("share");
    if (rows[0]?.version !== version) throw new Error("SIGNING_SOURCE_CHANGED");
  }
  revoke(kind: SigningJourneyKind, requestId: string, sourceVersion: number) {
    return this.tx(async (tx) => {
      await this.lockSource(tx, kind, requestId, sourceVersion);
      const changed = await tx
        .update(signingRecipients)
        .set({ revoked: true, nonce: sql`gen_random_uuid()` })
        .where(
          and(
            eq(signingRecipients.kind, kind),
            eq(signingRecipients.requestId, requestId),
            eq(signingRecipients.revoked, false),
          ),
        )
        .returning({ id: signingRecipients.id });
      if (changed.length)
        await this.audit(tx, requestId, "signing.access_revoked", {
          count: changed.length,
        });
    });
  }
  synchronize(snapshot: SigningJourneySnapshot, reminderEvent?: string) {
    return this.tx(async (tx) => {
      // Hold the source row stable while binding capabilities. A provider
      // read that raced a correction/resend must retry from the current source.
      await this.lockSource(
        tx,
        snapshot.kind,
        snapshot.requestId,
        snapshot.sourceVersion,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${snapshot.kind}:${snapshot.requestId}`}, 0))`,
      );
      await tx
        .update(signingRecipients)
        .set({ revoked: true, nonce: sql`gen_random_uuid()` })
        .where(
          and(
            eq(signingRecipients.kind, snapshot.kind),
            eq(signingRecipients.requestId, snapshot.requestId),
            or(
              ne(signingRecipients.providerId, snapshot.providerId),
              notInArray(
                signingRecipients.slot,
                snapshot.recipients.map((r) => r.slot),
              ),
            ),
            eq(signingRecipients.revoked, false),
          ),
        );
      for (const recipient of snapshot.recipients) {
        const [existing] = await tx
          .select()
          .from(signingRecipients)
          .where(
            and(
              eq(signingRecipients.providerId, snapshot.providerId),
              eq(signingRecipients.slot, recipient.slot),
            ),
          )
          .limit(1);
        if (
          existing &&
          (existing.kind !== snapshot.kind ||
            existing.requestId !== snapshot.requestId)
        )
          throw new Error("SIGNING_RECIPIENT_REBOUND");
        const changedAddress = existing && existing.email !== recipient.email;
        const nonce =
          !existing || existing.revoked || changedAddress
            ? randomUUID()
            : existing.nonce;
        const id = existing?.id ?? randomUUID();
        const row = {
          ...recipient,
          nextToSign: snapshot.nextSlot === recipient.slot,
          id,
          kind: snapshot.kind,
          requestId: snapshot.requestId,
          providerId: snapshot.providerId,
          title: snapshot.title,
          testMode: snapshot.testMode,
          nonce,
          revoked: false,
        };
        await tx
          .insert(signingRecipients)
          .values(row)
          .onConflictDoUpdate({ target: signingRecipients.id, set: row });
        if (!existing || changedAddress)
          await this.audit(tx, snapshot.requestId, "signing.recipient_bound", {
            recipientId: id,
            providerId: snapshot.providerId,
            slot: recipient.slot,
            corrected: Boolean(changedAddress),
          });
        const purpose: SigningMailPurpose | null =
          snapshot.state === "completed"
            ? "completed"
            : snapshot.nextSlot === recipient.slot
              ? reminderEvent
                ? "reminder"
                : "invite"
              : null;
        if (!purpose) continue;
        const key = `${id}:${nonce}:${purpose}:${purpose === "reminder" ? reminderEvent : "once"}`;
        const inserted = await tx
          .insert(signingMail)
          .values({
            id: randomUUID(),
            recipientId: id,
            recipientNonce: nonce,
            purpose,
            dedupeKey: key,
          })
          .onConflictDoNothing()
          .returning({ id: signingMail.id });
        if (inserted[0])
          await this.audit(tx, snapshot.requestId, "signing.mail_queued", {
            deliveryId: inserted[0].id,
            recipientId: id,
            purpose,
          });
      }
    });
  }
  claim(): Promise<SigningMailJob | null> {
    return this.tx(async (tx) => {
      // A process can die after its final lease. Make that exhaustion visible.
      await tx.execute(sql`update commerce_signing_mail set state = 'failed', lease_token = null, lease_until = null, provider_code = 'LEASE_EXHAUSTED'
        where state = 'sending' and attempts >= 6 and lease_until < now()`);
      const rows = await tx.execute(sql`
        with candidate as (
          select id from commerce_signing_mail
          where attempts < 6 and available_at <= now()
            and (state = 'pending' or (state = 'sending' and lease_until < now()))
          order by available_at, id for update skip locked limit 1
        )
        update commerce_signing_mail m set state = 'sending', attempts = attempts + 1,
          lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes'
        from candidate c where m.id = c.id
        returning m.id, m.recipient_id, m.recipient_nonce, m.purpose, m.attempts, m.lease_token`);
      const r = rows[0];
      return r
        ? {
            id: String(r.id),
            recipientId: String(r.recipient_id),
            recipientNonce: String(r.recipient_nonce),
            purpose: r.purpose as SigningMailPurpose,
            attempts: Number(r.attempts),
            leaseToken: String(r.lease_token),
          }
        : null;
    });
  }
  finish(
    job: SigningMailJob,
    state: "sent" | "skipped" | "failed" | "pending" | "deferred",
    code?: string,
  ) {
    return this.tx(async (tx) => {
      const finalState =
        state === "deferred"
          ? "pending"
          : state === "pending" && job.attempts >= 6
            ? "failed"
            : state;
      const changed = await tx
        .update(signingMail)
        .set({
          state: finalState,
          attempts:
            state === "deferred" ? Math.max(0, job.attempts - 1) : job.attempts,
          leaseToken: null,
          leaseUntil: null,
          providerCode: code?.slice(0, 80) ?? null,
          availableAt: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000,
          ),
        })
        .where(
          and(
            eq(signingMail.id, job.id),
            eq(signingMail.leaseToken, job.leaseToken),
          ),
        )
        .returning({ id: signingMail.id });
      if (changed.length)
        await this.audit(tx, job.id, `signing.mail_${finalState}`, {
          deliveryId: job.id,
          recipientId: job.recipientId,
          attempts: job.attempts,
          code: code ?? null,
        });
    });
  }
  private audit(
    tx: RuntimeTransaction,
    id: string,
    eventType: string,
    detail: Record<string, unknown>,
  ) {
    // Independent access/delivery events must not consume the agreement's
    // version chain. sourceId retains the evidence link, as in staff preferences.
    return appendAuditAndOutbox(tx, {
      aggregateType: "agreement",
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      metadata: { sourceId: id },
      eventType,
      actor: { kind: "system", id: "recipient-signing" },
      requestId: randomUUID(),
      after: detail,
    });
  }
}
