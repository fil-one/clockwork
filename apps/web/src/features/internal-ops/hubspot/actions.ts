"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  HubSpotHandoffInputSchema,
  hubspotLimits,
  withPartnerContactIds,
  type HubSpotImportRecord,
} from "@clockwork/contracts";
import { HubSpotError } from "@clockwork/integrations/hubspot";

import { SessionExpiredError } from "@/src/auth/session";

import { accountDocumentRepository } from "../account-documents/server";
import { attempt, type ActionResult } from "../contracts/action-result";
import { contractActor, contractStaff } from "../contracts/server";
import { partnerRepository, partnerToday } from "../partners/server";
import { buildHubSpotPlan, changedReviewItems, HandoffPlanError } from "./plan";
import {
  clearHubSpotCache,
  configuredPortal,
  hubspotContext,
  hubspotRepository,
  HubSpotUnavailableError,
  loadHandoffSource,
  requestDigest,
  similarPartnersFor,
} from "./server";

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  return attempt(async () => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SessionExpiredError)
        throw new Error("SESSION_EXPIRED");
      if (
        error instanceof HubSpotUnavailableError ||
        error instanceof HandoffPlanError
      )
        throw new Error(error.code);
      throw error;
    }
  });
}

export type HandoffCommitResult =
  | {
      kind: "committed";
      partnerId: string;
      importId: string;
      pendingDocuments: number;
    }
  | { kind: "already_linked"; partnerId: string; partnerName: string }
  | { kind: "source_changed"; items: string[] };

/**
 * Commits a reviewed handoff. The source is read again now: anything
 * selected that changed since the review sends the person back to it, and
 * nothing the browser sent is trusted as a source value. A retry of the same
 * operation, even after its answer was lost, resolves to the first result.
 */
export async function commitHubSpotHandoff(raw: unknown) {
  return run(async (): Promise<HandoffCommitResult> => {
    const session = await contractStaff("contract:write");
    const actor = contractActor(session);
    const handoff = HubSpotHandoffInputSchema.parse(raw);
    const digest = requestDigest(raw);
    const repository = hubspotRepository();
    const prior = await repository.operation(handoff.operationId);
    if (prior) {
      if (prior.requestDigest !== digest || prior.createdById !== actor.id)
        throw new Error("HUBSPOT_OPERATION_CONFLICT");
      const record = await repository.import(
        prior.partnerId,
        handoff.operationId,
      );
      return {
        kind: "committed",
        partnerId: prior.partnerId,
        importId: handoff.operationId,
        pendingDocuments: record.items.filter((i) => i.status === "pending")
          .length,
      };
    }
    const context = await hubspotContext();
    if (
      context.connection.id !== handoff.connection.id ||
      context.connection.version !== handoff.connection.version
    )
      throw new Error("HUBSPOT_CONNECTION_CHANGED");
    const source = await loadHandoffSource(context, handoff.source);
    const changed = changedReviewItems(
      handoff.reviewed,
      source.digests,
      handoff,
    );
    if (changed.length) return { kind: "source_changed", items: changed };
    if (handoff.destination.kind === "new_partner") {
      const dismissed = new Set(
        handoff.destination.dismissedSuggestions.map((item) => item.partnerId),
      );
      const similar = await similarPartnersFor(repository, source);
      if (similar.some((partner) => !dismissed.has(partner.id)))
        throw new Error("HUBSPOT_DECISION_REQUIRED");
    }
    const partners = partnerRepository();
    const found =
      handoff.destination.kind === "existing_partner"
        ? (await partners.get(handoff.destination.partnerId, partnerToday()))
            .partner
        : null;
    // The same contact IDs the review used, including derived ones.
    const destination = found
      ? { ...found, contacts: withPartnerContactIds(found.id, found.contacts) }
      : null;
    const [history, owners] = await Promise.all([
      destination
        ? repository.fieldHistory(destination.id)
        : Promise.resolve({}),
      handoff.destination.kind === "new_partner" && handoff.destination.ownerId
        ? partners.owners()
        : Promise.resolve([]),
    ]);
    const ownerId =
      handoff.destination.kind === "new_partner"
        ? handoff.destination.ownerId
        : null;
    const { plan, snapshot } = buildHubSpotPlan({
      source,
      handoff,
      destination,
      history,
      ownerName: owners.find((owner) => owner.id === ownerId)?.name ?? null,
      newId: randomUUID,
    });
    const result = await repository.commit(
      {
        plan,
        snapshot,
        requestDigest: digest,
        connection: handoff.connection,
        companyId: handoff.source.companyId,
        dealId: handoff.source.dealId,
      },
      actor,
    );
    revalidatePath("/internal/partners");
    revalidatePath("/internal/pipeline");
    if (result.kind === "already_linked") return result;
    revalidatePath(`/internal/partners/${result.partnerId}`);
    return {
      kind: "committed",
      partnerId: result.partnerId,
      importId: result.importId,
      pendingDocuments: plan.documents.length,
    };
  });
}

const ItemSchema = z
  .object({ partnerId: z.guid(), importId: z.guid(), itemId: z.guid() })
  .strict();

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Brings one selected document across: re-reads the file's current version,
 * refuses one that changed since the review, keeps the original bytes as a
 * private attachment with HubSpot provenance, and stops at an identical PDF
 * already on the partner so a person chooses what happens. Each attempt is
 * recorded; a retry never repeats anything already done.
 */
export async function processHubSpotDocument(raw: unknown) {
  return run(async (): Promise<HubSpotImportRecord> => {
    const session = await contractStaff("contract:write");
    const actor = contractActor(session);
    const { partnerId, importId, itemId } = ItemSchema.parse(raw);
    const repository = hubspotRepository();
    const record = await repository.import(partnerId, importId);
    const item = record.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("HUBSPOT_ITEM_NOT_FOUND");
    if (!["pending", "failed"].includes(item.status))
      throw new Error("HUBSPOT_ITEM_RESOLVED");
    // A previous attempt attached it but its answer was lost.
    const already = await repository.attachmentOnPartner(partnerId, item.id);
    if (already)
      return repository.recordItem(
        partnerId,
        importId,
        item.id,
        { status: "attached", attachmentId: already.id },
        actor,
      );
    const fail = (errorCode: string) =>
      repository.recordItem(
        partnerId,
        importId,
        item.id,
        { status: "failed", errorCode },
        actor,
      );
    let bytes: Uint8Array;
    try {
      const context = await hubspotContext();
      if (context.connection.portalId !== record.portalId)
        return await fail("HUBSPOT_PORTAL_MISMATCH");
      if (!context.connection.scope.files)
        return await fail("HUBSPOT_SCOPE_DENIED");
      const file = await context.reader.file(item.fileId, item.noteId);
      if (!file || file.availability !== "available")
        return await fail("HUBSPOT_DOCUMENT_UNAVAILABLE");
      const reviewed = record.plan.documents.find(
        (document) => document.fileId === item.fileId,
      );
      // A file replaced in HubSpot since the review needs a fresh review.
      if (
        reviewed &&
        ((reviewed.updatedAt && file.updatedAt !== reviewed.updatedAt) ||
          (reviewed.size !== null && file.size !== reviewed.size))
      )
        return await fail("HUBSPOT_DOCUMENT_CHANGED");
      bytes = await context.reader.download(
        item.fileId,
        hubspotLimits.documentBytes,
      );
    } catch (error) {
      if (error instanceof HubSpotUnavailableError) return fail(error.code);
      if (error instanceof HubSpotError) return fail(error.code);
      throw error;
    }
    const hash = sha256(bytes);
    const duplicate = await repository.attachmentByHash(partnerId, hash);
    if (duplicate)
      return repository.recordItem(
        partnerId,
        importId,
        item.id,
        { status: "duplicate", existingAttachmentId: duplicate.id },
        actor,
      );
    try {
      const attached = await accountDocumentRepository().add(
        { type: "partner", id: partnerId },
        { id: item.id, title: item.title, kind: item.documentKind },
        { fileName: item.fileName, bytes },
        actor,
        {
          provider: "hubspot",
          portalId: record.portalId,
          fileId: item.fileId,
          noteId: item.noteId,
          importId,
        },
      );
      revalidatePath(`/internal/partners/${partnerId}`);
      return repository.recordItem(
        partnerId,
        importId,
        item.id,
        { status: "attached", attachmentId: attached.id },
        actor,
      );
    } catch (error) {
      const code =
        error instanceof z.ZodError
          ? "DOCUMENT_INVALID"
          : error instanceof Error
            ? error.message
            : "";
      if (code === "ATTACHMENT_ALREADY_EXISTS") {
        const existing = await repository.attachmentByHash(partnerId, hash);
        if (existing)
          return repository.recordItem(
            partnerId,
            importId,
            item.id,
            { status: "duplicate", existingAttachmentId: existing.id },
            actor,
          );
      }
      if (code === "ATTACHMENT_RETRY_CONFLICT") {
        const mine = await repository.attachmentOnPartner(partnerId, item.id);
        if (mine)
          return repository.recordItem(
            partnerId,
            importId,
            item.id,
            { status: "attached", attachmentId: mine.id },
            actor,
          );
      }
      return fail(
        /^(DOCUMENT_|ATTACHMENT_)/.test(code)
          ? "HUBSPOT_DOCUMENT_INVALID"
          : "HUBSPOT_DOCUMENT_UNAVAILABLE",
      );
    }
  });
}

/** Uses the identical PDF already on the partner for a duplicate document. */
export async function reuseHubSpotDocument(raw: unknown) {
  return run(async () => {
    const session = await contractStaff("contract:write");
    const { partnerId, importId, itemId } = ItemSchema.parse(raw);
    const record = await hubspotRepository().reuseExisting(
      partnerId,
      importId,
      itemId,
      contractActor(session),
    );
    revalidatePath(`/internal/partners/${partnerId}`);
    return record;
  });
}

/**
 * Leaves a document out and finishes the handoff without it. The receipt
 * then says "Completed with 1 item excluded", never a clean success.
 */
export async function excludeHubSpotDocument(raw: unknown) {
  return run(async () => {
    const session = await contractStaff("contract:write");
    const input = ItemSchema.extend({
      reason: z.string().trim().min(1).max(500),
    })
      .strict()
      .parse(raw);
    const record = await hubspotRepository().excludeItem(
      input.partnerId,
      input.importId,
      input.itemId,
      input.reason,
      contractActor(session),
    );
    revalidatePath(`/internal/partners/${input.partnerId}`);
    return record;
  });
}

/** Reads HubSpot again for every page, without importing anything. */
export async function refreshHubSpotData() {
  return run(async () => {
    await contractStaff("sales:read");
    clearHubSpotCache();
    revalidatePath("/internal/pipeline");
    return null;
  });
}

/**
 * Activates the connection, or changes its scope. The token's portal is
 * read now and must be the one the administrator approved on the page.
 */
export async function saveHubSpotConnection(raw: unknown) {
  return run(async () => {
    const session = await contractStaff("staff:manage");
    const portal = await configuredPortal();
    if (!portal) throw new Error("HUBSPOT_NOT_CONFIGURED");
    const connection = await hubspotRepository().saveConnection(
      raw,
      portal,
      contractActor(session),
    );
    clearHubSpotCache();
    revalidatePath("/internal/owner/hubspot");
    return { id: connection.id, version: connection.version };
  });
}

/**
 * Stops live HubSpot reads. Imported records, documents and history stay;
 * pending reviews can no longer be committed.
 */
export async function disconnectHubSpot(raw: unknown) {
  return run(async () => {
    const session = await contractStaff("staff:manage");
    const { expectedVersion } = z
      .object({ expectedVersion: z.int().min(1) })
      .strict()
      .parse(raw);
    await hubspotRepository().disconnect(
      expectedVersion,
      contractActor(session),
    );
    clearHubSpotCache();
    revalidatePath("/internal/owner/hubspot");
    return null;
  });
}
