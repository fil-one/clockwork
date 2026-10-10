import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import {
  HandoffDecisionInputSchema,
  HandoffRequestInputSchema,
  handoffListLimit,
  type Actor,
  type ContractSigner,
  type ContractStatus,
  type HandoffRequestRecord,
  type HandoffStatus,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { commerceContracts, contractSigning } from "../../schema/contracts";
import { handoffRequests } from "../../schema/handoff-requests";
import { mndaRequests } from "../../schema/mnda";
import { pricingScenarios } from "../../schema/pricing-scenarios";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

type Row = typeof handoffRequests.$inferSelect;
type UserActor = Actor & { kind: "user" };

/**
 * Which requests a caller reads: a seller their own, operations the whole
 * queue. The web layer decides from the session; the service role does not
 * narrow rows itself.
 */
export type HandoffScope = { kind: "own"; userId: string } | { kind: "all" };

/** A contract as a handoff shows it. */
export interface HandoffContractSummary {
  id: string;
  counterpartyName: string;
  title: string;
  /**
   * How it came to be signed: `commerce` when Commerce ran the signing and it
   * completed, `recorded` when staff recorded it in the register as executed.
   */
  signedVia: "commerce" | "recorded" | null;
  status: ContractStatus;
  signed: boolean;
}

export interface HandoffMndaSummary {
  id: string;
  company: string;
  signerName: string;
  completedAt: string | null;
}

export interface HandoffScenarioSummary {
  id: string;
  name: string;
  company: string;
}

export interface HandoffRequestDetail extends HandoffRequestRecord {
  contracts: HandoffContractSummary[];
  mnda: HandoffMndaSummary | null;
  pricingScenario: HandoffScenarioSummary | null;
}

/** What the contract record offers a seller who hands it to operations. */
export interface HandoffContractContext {
  contract: HandoffContractSummary;
  /** The counterparty signer of a template contract, to prefill the form. */
  signer: ContractSigner | null;
  /** Completed MNDAs with the same company, newest first. */
  mndas: HandoffMndaSummary[];
  /** The scenarios the caller may attach, newest first. */
  scenarios: HandoffScenarioSummary[];
  /** Every request that names this contract, newest first. */
  requests: HandoffRequestRecord[];
}

const view = (row: Row): HandoffRequestRecord => ({
  id: row.id,
  requestedById: row.requestedById,
  requestedByName: row.requestedByName,
  counterpartyLegalName: row.counterpartyLegalName,
  signerName: row.signerName,
  signerEmail: row.signerEmail,
  signerTitle: row.signerTitle,
  contractIds: [...row.contractIds],
  mndaId: row.mndaId,
  pricingScenarioId: row.pricingScenarioId,
  requestedSide: row.requestedSide,
  notes: row.notes,
  status: row.status,
  assigneeId: row.assigneeId,
  assigneeName: row.assigneeName,
  decisionNote: row.decisionNote,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  organizationId: row.organizationId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});

/**
 * The database refuses with an upper-case code (001462); Drizzle wraps the
 * driver error, so the code is looked for on the error and its cause.
 */
function databaseRefusal(error: unknown): string | undefined {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 4;
    current = current.cause, depth += 1
  ) {
    const match = /\b(HANDOFF_[A-Z_]+)\b/.exec(current.message);
    if (match) return match[1];
  }
  return undefined;
}

async function refusalsAsCodes<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = databaseRefusal(error);
    if (code) throw new Error(code);
    throw error;
  }
}

/**
 * Handoff requests from sales to operations (001462). Every change writes one
 * `handoff.*` audit event in the same transaction.
 */
export class HandoffRequestRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return refusalsAsCodes(() =>
      withInternalTransaction(this.db, randomUUID(), fn),
    );
  }

  /** Newest first: a seller's own requests, or the whole queue. */
  list(scope: HandoffScope, status?: HandoffStatus) {
    const where: SQL[] = [];
    if (scope.kind === "own")
      where.push(eq(handoffRequests.requestedById, scope.userId));
    if (status) where.push(eq(handoffRequests.status, status));
    return this.tx(async (tx) =>
      (
        await tx
          .select()
          .from(handoffRequests)
          .where(where.length ? and(...where) : undefined)
          .orderBy(desc(handoffRequests.createdAt), desc(handoffRequests.id))
          .limit(handoffListLimit)
      ).map(view),
    );
  }

  /** A request outside the caller's scope reads as missing. */
  async get(id: string, scope: HandoffScope): Promise<HandoffRequestDetail> {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(handoffRequests)
        .where(eq(handoffRequests.id, id));
      if (!row || (scope.kind === "own" && row.requestedById !== scope.userId))
        throw new Error("HANDOFF_NOT_FOUND");
      const contracts = await contractSummaries(tx, row.contractIds);
      const [mnda] = row.mndaId ? await mndaSummaries(tx, [row.mndaId]) : [];
      const [scenario] = row.pricingScenarioId
        ? await tx
            .select({
              id: pricingScenarios.id,
              name: pricingScenarios.name,
              company: pricingScenarios.company,
            })
            .from(pricingScenarios)
            .where(eq(pricingScenarios.id, row.pricingScenarioId))
        : [];
      return {
        ...view(row),
        contracts: row.contractIds.flatMap((contractId) =>
          contracts.filter((contract) => contract.id === contractId),
        ),
        mnda: mnda ?? null,
        pricingScenario: scenario ?? null,
      };
    });
  }

  /**
   * What the contract record needs to offer a handoff: the contract, its
   * counterparty signer when Commerce prepared it, completed MNDAs with the
   * same company, the caller's scenarios and the requests already raised.
   */
  contractContext(
    contractId: string,
    scope: HandoffScope,
  ): Promise<HandoffContractContext> {
    return this.tx(async (tx) => {
      const [contract] = await contractSummaries(tx, [contractId]);
      if (!contract) throw new Error("HANDOFF_NOT_FOUND");
      const [signing] = await tx
        .select({ signer: contractSigning.counterpartySigner })
        .from(contractSigning)
        .where(eq(contractSigning.contractId, contractId));
      const mndaIds = await tx
        .select({ id: mndaRequests.id })
        .from(mndaRequests)
        .where(
          and(
            eq(mndaRequests.state, "completed"),
            sql`${mndaRequests.normalizedCompany} = public.commerce_mnda_normalize_company(${contract.counterpartyName})`,
          ),
        )
        .orderBy(desc(mndaRequests.completedAt))
        .limit(20);
      const scenarios = await tx
        .select({
          id: pricingScenarios.id,
          name: pricingScenarios.name,
          company: pricingScenarios.company,
        })
        .from(pricingScenarios)
        .where(
          scope.kind === "own"
            ? eq(pricingScenarios.ownerId, scope.userId)
            : undefined,
        )
        .orderBy(desc(pricingScenarios.updatedAt))
        .limit(100);
      const requests = await tx
        .select()
        .from(handoffRequests)
        .where(
          sql`${handoffRequests.contractIds} @> array[${contractId}]::uuid[]`,
        )
        .orderBy(desc(handoffRequests.createdAt));
      return {
        contract,
        signer: signing?.signer ?? null,
        mndas: await mndaSummaries(
          tx,
          mndaIds.map(({ id }) => id),
        ),
        scenarios,
        requests: requests.map(view),
      };
    });
  }

  /**
   * Raises a request. A retried submission with the same id returns the
   * stored request; the database checks every contract is signed and not in
   * another open request, the MNDA completed and the scenario exists.
   */
  create(
    raw: unknown,
    actor: UserActor,
    options: {
      /** A commerce administrator may attach any seller's scenario. */
      anyScenario?: boolean;
    } = {},
  ) {
    const input = HandoffRequestInputSchema.parse(raw);
    return this.tx(async (tx) => {
      const [existing] = await tx
        .select()
        .from(handoffRequests)
        .where(eq(handoffRequests.id, input.id));
      if (existing) {
        if (existing.requestedById !== actor.id)
          throw new Error("HANDOFF_IDEMPOTENCY_CONFLICT");
        return view(existing);
      }
      // A seller attaches their own scenario, and only an MNDA with the
      // company the contract names; an id from elsewhere is refused.
      if (input.pricingScenarioId) {
        const [scenario] = await tx
          .select({ ownerId: pricingScenarios.ownerId })
          .from(pricingScenarios)
          .where(eq(pricingScenarios.id, input.pricingScenarioId));
        if (!scenario) throw new Error("HANDOFF_PRICING_SCENARIO_NOT_FOUND");
        if (scenario.ownerId !== actor.id && !options.anyScenario)
          throw new Error("HANDOFF_PRICING_SCENARIO_NOT_OWNED");
      }
      if (input.mndaId) {
        const [match] = await tx.execute<{ matches: boolean }>(sql`
          select exists (
            select 1
            from public.commerce_mnda_requests m
            join public.commerce_contracts c
              on c.id in (${sql.join(
                input.contractIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})
            where m.id = ${input.mndaId}
              and m.normalized_company =
                public.commerce_mnda_normalize_company(c.counterparty_name)
          ) as matches`);
        const [found] = await tx
          .select({ id: mndaRequests.id })
          .from(mndaRequests)
          .where(eq(mndaRequests.id, input.mndaId));
        if (found && !match?.matches)
          throw new Error("HANDOFF_MNDA_COMPANY_MISMATCH");
      }
      const [row] = await tx
        .insert(handoffRequests)
        .values({
          id: input.id,
          requestedById: actor.id,
          requestedByName: actor.display ?? actor.id,
          counterpartyLegalName: input.counterpartyLegalName,
          signerName: input.signerName,
          signerEmail: input.signerEmail,
          signerTitle: input.signerTitle,
          contractIds: input.contractIds,
          mndaId: input.mndaId,
          pricingScenarioId: input.pricingScenarioId,
          requestedSide: input.requestedSide,
          notes: input.notes.trim(),
        })
        .returning();
      if (!row) throw new Error("HANDOFF_INSERT_FAILED");
      await audit(tx, row, actor, "handoff.requested");
      return view(row);
    });
  }

  /** Operations takes an open request, or takes over one in progress. */
  take(raw: unknown, actor: UserActor) {
    return this.transition(raw, actor, "handoff.taken", (current) => {
      if (current.status !== "open" && current.status !== "in_progress")
        throw new Error("HANDOFF_TRANSITION_INVALID");
      return {
        status: "in_progress",
        assigneeId: actor.id,
        assigneeName: actor.display ?? actor.id,
      };
    });
  }

  /**
   * The person working the request marks it done. Someone else takes it over
   * first; a commerce administrator may complete it for them.
   */
  complete(
    raw: unknown,
    actor: UserActor,
    options: { anyAssignee?: boolean } = {},
  ) {
    return this.transition(raw, actor, "handoff.completed", (current, note) => {
      if (current.status !== "in_progress")
        throw new Error("HANDOFF_TRANSITION_INVALID");
      if (current.assigneeId !== actor.id && !options.anyAssignee)
        throw new Error("HANDOFF_NOT_ASSIGNEE");
      return {
        status: "done",
        decisionNote: note ?? null,
        decidedById: actor.id,
        decidedAt: sql`now()`,
      };
    });
  }

  /** Declines an open or in-progress request, with a note for the seller. */
  decline(raw: unknown, actor: UserActor) {
    return this.transition(raw, actor, "handoff.declined", (current, note) => {
      if (current.status !== "open" && current.status !== "in_progress")
        throw new Error("HANDOFF_TRANSITION_INVALID");
      if (!note) throw new Error("HANDOFF_DECLINE_NOTE_REQUIRED");
      return {
        status: "declined",
        decisionNote: note,
        decidedById: actor.id,
        decidedAt: sql`now()`,
      };
    });
  }

  private transition(
    raw: unknown,
    actor: UserActor,
    eventType: string,
    change: (
      current: Row,
      note: string | undefined,
    ) => PgUpdateSetSource<typeof handoffRequests>,
  ) {
    const input = HandoffDecisionInputSchema.parse(raw);
    return this.tx(async (tx) => {
      const current = await lockHandoffRequest(tx, input.id);
      if (current.version !== input.expectedVersion)
        throw new Error("HANDOFF_VERSION_CONFLICT");
      if (current.status === "done" || current.status === "declined")
        throw new Error("HANDOFF_REQUEST_CLOSED");
      const [row] = await tx
        .update(handoffRequests)
        .set({
          ...change(current, input.note),
          updatedAt: sql`now()`,
          version: current.version + 1,
        })
        .where(eq(handoffRequests.id, input.id))
        .returning();
      if (!row) throw new Error("HANDOFF_UPDATE_FAILED");
      await audit(tx, row, actor, eventType);
      return view(row);
    });
  }
}

/** Locks one request for a change inside the caller's transaction. */
export async function lockHandoffRequest(
  tx: RuntimeTransaction,
  id: string,
): Promise<Row> {
  const [row] = await tx
    .select()
    .from(handoffRequests)
    .where(eq(handoffRequests.id, id))
    .for("update");
  if (!row) throw new Error("HANDOFF_NOT_FOUND");
  return row;
}

async function contractSummaries(
  tx: RuntimeTransaction,
  contractIds: readonly string[],
): Promise<HandoffContractSummary[]> {
  if (contractIds.length === 0) return [];
  const rows = await tx
    .select({
      id: commerceContracts.id,
      counterpartyName: commerceContracts.counterpartyName,
      title: commerceContracts.title,
      status: commerceContracts.status,
      signingState: contractSigning.state,
    })
    .from(commerceContracts)
    .leftJoin(
      contractSigning,
      eq(contractSigning.contractId, commerceContracts.id),
    )
    .where(inArray(commerceContracts.id, [...contractIds]));
  return rows.map(({ signingState, ...row }) => ({
    ...row,
    signed: row.status === "executed" || signingState === "completed",
    signedVia:
      signingState === "completed"
        ? "commerce"
        : row.status === "executed"
          ? "recorded"
          : null,
  }));
}

async function mndaSummaries(
  tx: RuntimeTransaction,
  mndaIds: readonly string[],
): Promise<HandoffMndaSummary[]> {
  if (mndaIds.length === 0) return [];
  const rows = await tx
    .select({
      id: mndaRequests.id,
      input: mndaRequests.input,
      completedAt: mndaRequests.completedAt,
    })
    .from(mndaRequests)
    .where(inArray(mndaRequests.id, [...mndaIds]));
  return mndaIds.flatMap((id) =>
    rows
      .filter((row) => row.id === id)
      .map((row) => ({
        id: row.id,
        company: row.input.company,
        signerName: row.input.signerName,
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
  );
}

/** Appends one `handoff.*` event for the request's new state. */
export function auditHandoffRequest(
  tx: RuntimeTransaction,
  row: Row,
  actor: Actor,
  eventType: string,
) {
  return audit(tx, row, actor, eventType);
}

function audit(
  tx: RuntimeTransaction,
  row: Row,
  actor: Actor,
  eventType: string,
) {
  return appendAuditAndOutbox(tx, {
    aggregateType: "handoff_request",
    aggregateId: row.id,
    aggregateVersion: row.version,
    eventType,
    actor,
    requestId: randomUUID(),
    after: {
      status: row.status,
      counterpartyLegalName: row.counterpartyLegalName,
      contractIds: row.contractIds,
      mndaId: row.mndaId,
      pricingScenarioId: row.pricingScenarioId,
      requestedSide: row.requestedSide,
      requestedById: row.requestedById,
      assigneeId: row.assigneeId,
      organizationId: row.organizationId,
      ...(row.decisionNote ? { decisionNote: row.decisionNote } : {}),
    },
  });
}
