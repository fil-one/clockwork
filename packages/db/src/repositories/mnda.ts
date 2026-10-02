import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  MndaInputSchema,
  MndaSignerSchema,
  type Actor,
  type MndaRecord,
  type MndaSigner,
  type MndaState,
} from "@clockwork/contracts";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { mndaSigners, mndaRequests, mndaArtifacts } from "../schema/mnda";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

type Row = typeof mndaRequests.$inferSelect;
const view = (r: Row): MndaRecord => ({
  id: r.id,
  input: r.input,
  countersigner: r.countersigner,
  ownerId: r.ownerId,
  ownerName: r.ownerName,
  state: r.state,
  providerId: r.providerId,
  testMode: r.testMode,
  templateHash: r.templateHash,
  error: r.error,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
});
export const terminalMndaStates: readonly MndaState[] = [
  "completed",
  "declined",
  "expired",
  "canceled",
];
export class MndaRepository {
  constructor(private readonly db: RuntimeDatabase) {}
  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }
  list() {
    return this.tx(async (tx) =>
      (
        await tx
          .select()
          .from(mndaRequests)
          .orderBy(desc(mndaRequests.createdAt))
          .limit(200)
      ).map(view),
    );
  }
  signers() {
    return this.tx((tx) =>
      tx.select().from(mndaSigners).orderBy(mndaSigners.name),
    );
  }
  get(id: string) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.id, id));
      if (!r) throw new Error("MNDA_NOT_FOUND");
      return view(r);
    });
  }
  byProvider(id: string) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.providerId, id));
      return r ? view(r) : null;
    });
  }
  async saveSigner(raw: unknown, actor: Actor) {
    const input = MndaSignerSchema.parse(raw);
    if (input.isDefault && !input.active)
      throw new Error("MNDA_DEFAULT_MUST_BE_ACTIVE");
    return this.tx(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1439,1)`);
      if (input.isDefault)
        await tx
          .update(mndaSigners)
          .set({ isDefault: false })
          .where(eq(mndaSigners.isDefault, true));
      const [previous] = await tx
        .select()
        .from(mndaSigners)
        .where(eq(mndaSigners.id, input.id));
      const version = (previous?.version ?? 0) + 1;
      await tx
        .insert(mndaSigners)
        .values({ ...input, version })
        .onConflictDoUpdate({
          target: mndaSigners.id,
          set: { ...input, version },
        });
      await appendAuditAndOutbox(tx, {
        aggregateType: "agreement_template",
        aggregateId: input.id,
        aggregateVersion: version,
        eventType: "mnda.signer_configured",
        actor,
        requestId: randomUUID(),
        after: {
          name: input.name,
          email: input.email,
          title: input.title,
          active: input.active,
          isDefault: input.isDefault,
        },
      });
    });
  }
  async create(
    raw: unknown,
    owner: { id: string; name: string },
    templateHash: string,
    testMode: boolean,
    pdf: Uint8Array,
    signer: MndaSigner,
  ) {
    const input = MndaInputSchema.parse(raw);
    return this.tx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.id}))`,
      );
      const [existing] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.id, input.id));
      if (existing) {
        if (
          JSON.stringify(MndaInputSchema.parse(existing.input)) !==
            JSON.stringify(input) ||
          existing.ownerId !== owner.id
        )
          throw new Error("MNDA_IDEMPOTENCY_CONFLICT");
        return view(existing);
      }
      const [activeSigner] = await tx
        .select()
        .from(mndaSigners)
        .where(
          and(eq(mndaSigners.id, signer.id), eq(mndaSigners.active, true)),
        );
      if (
        !activeSigner ||
        activeSigner.name !== signer.name ||
        activeSigner.title !== signer.title ||
        activeSigner.email !== signer.email
      )
        throw new Error("MNDA_SIGNER_CHANGED");
      const [r] = await tx
        .insert(mndaRequests)
        .values({
          id: input.id,
          input,
          countersigner: signer,
          ownerId: owner.id,
          ownerName: owner.name,
          templateHash,
          testMode,
        })
        .returning();
      if (!r) throw new Error("MNDA_CREATE_FAILED");
      await this.artifact(tx, input.id, "original", pdf);
      await this.audit(
        tx,
        r,
        { kind: "user", id: owner.id, display: owner.name },
        "mnda.drafted",
      );
      return view(r);
    });
  }
  private artifact(
    tx: RuntimeTransaction,
    id: string,
    kind: "original" | "executed",
    bytes: Uint8Array,
  ) {
    if (
      bytes.length > 12_000_000 ||
      Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
    )
      throw new Error("MNDA_INVALID_PDF");
    return tx.insert(mndaArtifacts).values({
      id: randomUUID(),
      requestId: id,
      kind,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      base64: Buffer.from(bytes).toString("base64"),
    });
  }
  readArtifact(id: string, kind: "original" | "executed") {
    return this.tx(async (tx) => {
      const [a] = await tx
        .select()
        .from(mndaArtifacts)
        .where(
          and(eq(mndaArtifacts.requestId, id), eq(mndaArtifacts.kind, kind)),
        );
      if (!a) throw new Error("MNDA_ARTIFACT_NOT_FOUND");
      const bytes = Buffer.from(a.base64, "base64");
      if (createHash("sha256").update(bytes).digest("hex") !== a.sha256)
        throw new Error("MNDA_ARTIFACT_INTEGRITY");
      return bytes;
    });
  }
  /** Lease spans provider I/O without holding a database transaction open. */
  claim(id: string) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.id, id))
        .for("update");
      if (!r) throw new Error("MNDA_NOT_FOUND");
      if (r.leaseUntil && r.leaseUntil > new Date())
        throw new Error("MNDA_BUSY");
      const token = randomUUID();
      await tx
        .update(mndaRequests)
        .set({ leaseToken: token, leaseUntil: new Date(Date.now() + 120_000) })
        .where(eq(mndaRequests.id, id));
      return { record: view(r), token };
    });
  }
  release(id: string, token: string) {
    return this.tx(async (tx) => {
      await tx
        .update(mndaRequests)
        .set({ leaseToken: null, leaseUntil: null })
        .where(
          and(eq(mndaRequests.id, id), eq(mndaRequests.leaseToken, token)),
        );
    });
  }
  update(
    id: string,
    token: string,
    patch: { state?: MndaState; providerId?: string; error?: string | null },
    actor: Actor,
    executed?: Uint8Array,
  ) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(and(eq(mndaRequests.id, id), eq(mndaRequests.leaseToken, token)))
        .for("update");
      if (!r) throw new Error("MNDA_LEASE_LOST");
      if (terminalMndaStates.includes(r.state)) return view(r);
      if (executed) await this.artifact(tx, id, "executed", executed);
      const [next] = await tx
        .update(mndaRequests)
        .set({
          ...patch,
          leaseUntil: new Date(Date.now() + 120_000),
          version: r.version + 1,
          updatedAt: new Date(),
          ...(patch.state === "completed" ? { completedAt: new Date() } : {}),
        })
        .where(eq(mndaRequests.id, id))
        .returning();
      if (!next) throw new Error("MNDA_UPDATE_FAILED");
      await this.audit(tx, next, actor, `mnda.${next.state}`);
      return view(next);
    });
  }
  private audit(
    tx: RuntimeTransaction,
    r: Row,
    actor: Actor,
    eventType: string,
  ) {
    return appendAuditAndOutbox(tx, {
      aggregateType: "agreement",
      aggregateId: r.id,
      aggregateVersion: r.version,
      eventType,
      actor,
      requestId: randomUUID(),
      after: {
        state: r.state,
        providerId: r.providerId,
        templateHash: r.templateHash,
        testMode: r.testMode,
      },
    });
  }
}
