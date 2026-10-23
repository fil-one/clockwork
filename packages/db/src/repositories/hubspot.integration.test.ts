import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  HubSpotHandoffPlan,
  HubSpotSourceSnapshot,
} from "@clockwork/contracts";

import { createRuntimeDatabase } from "../client";
import { AccountDocumentRepository } from "./account-documents";
import {
  ContractDocumentStores,
  PostgresContractDocumentStore,
} from "./contract-documents";
import { HubSpotRepository } from "./hubspot";
import { PartnerRepository } from "./partners";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

const repo = new HubSpotRepository(db);
const partners = new PartnerRepository(db);
const documents = new AccountDocumentRepository(
  db,
  new ContractDocumentStores(new PostgresContractDocumentStore(db)),
);
// Seeded staff with the sales workspace.
const staffId = "20000000-0000-4000-8000-000000000001";
const seller = { kind: "user" as const, id: staffId, display: "Iris Operator" };
const otherSeller = {
  kind: "user" as const,
  id: randomUUID(),
  display: "Second Seller",
};
// A portal of our own so reruns and other suites never share links.
const portalId = String(Date.now()).slice(-9);
const tag = randomUUID().slice(0, 8);
const digest = (n: number) => String(n).repeat(64).slice(0, 64);
let connection = { id: "", version: 0 };
const createdPartners: string[] = [];

beforeAll(async () => {
  // Only one connection may be active; this suite brings its own.
  await client`update commerce_hubspot_connections
    set status = 'disconnected', disconnected_at = now(), version = version + 1
    where status = 'active'`;
  const saved = await repo.saveConnection(
    {
      portalId,
      audienceAccepted: true,
      scope: {
        company: ["industry"],
        pipelines: ["default"],
        notes: true,
        files: true,
      },
      ownerMappings: [{ hubspotOwnerId: "101", staffId }],
    },
    { portalId, uiDomain: "app.hubspot.com" },
    seller,
  );
  connection = { id: saved.id, version: saved.version };
});

afterAll(async () => {
  await client`delete from commerce_hubspot_import_items where import_id in (
    select id from commerce_hubspot_imports where portal_id = ${portalId})`;
  await client`delete from commerce_hubspot_imports where portal_id = ${portalId}`;
  await client`delete from commerce_external_links where portal_id = ${portalId}`;
  await client`delete from commerce_hubspot_connections where portal_id = ${portalId}`;
  await client.end();
});

const snapshot = (companyId: string, name: string): HubSpotSourceSnapshot => ({
  portalId,
  uiDomain: "app.hubspot.com",
  retrievedAt: new Date().toISOString(),
  company: {
    id: companyId,
    url: `https://app.hubspot.com/contacts/${portalId}/record/0-2/${companyId}`,
    name,
    updatedAt: null,
    owner: { id: "101", name: "Priya Raman" },
  },
  values: [
    {
      objectType: "company",
      property: "name",
      label: "Company name",
      type: "string",
      value: name,
    },
  ],
  deal: null,
  notes: [],
});

const newPlan = (
  companyName: string,
  overrides: Partial<HubSpotHandoffPlan> = {},
): HubSpotHandoffPlan => {
  const partnerId = randomUUID();
  createdPartners.push(partnerId);
  return {
    operationId: randomUUID(),
    destination: {
      kind: "new_partner",
      partnerId,
      name: companyName,
      status: "prospect",
      ownerId: staffId,
      ownerName: "Iris Operator",
      models: ["resale"],
    },
    fields: [
      {
        field: "name",
        action: "add",
        current: "",
        hubspot: companyName,
        result: companyName,
        drift: "never_imported",
        source: { property: "name", label: "Company name", value: companyName },
      },
      {
        field: "website",
        action: "add",
        current: "",
        hubspot: "https://northstar.example",
        result: "https://northstar.example",
        drift: "never_imported",
        source: {
          property: "domain",
          label: "Domain",
          value: "northstar.example",
        },
      },
    ],
    contacts: [
      {
        id: randomUUID(),
        hubspotId: "5001",
        name: "Ada Okafor",
        email: "ada@northstar.example",
        role: "VP Partnerships",
        labels: ["Decision maker"],
        matchedExisting: false,
      },
    ],
    primaryContactId: null,
    deal: null,
    notes: [],
    references: [],
    documents: [],
    dismissedSuggestions: [],
    omitted: { contacts: 0, notes: 0, documents: 0, properties: 0 },
    ...overrides,
  };
};

describe("HubSpot handoff", () => {
  it("creates a partner, its link and the import in one commit", async () => {
    const companyId = "910001";
    const name = `Northstar ${tag}`;
    const plan = newPlan(name, {
      documents: [
        {
          fileId: "8001",
          noteId: "6001",
          fileName: "Order form.pdf",
          title: "Order form",
          kind: "agreement",
          size: 1000,
          updatedAt: null,
        },
      ],
    });
    const result = await repo.commit(
      {
        plan,
        snapshot: snapshot(companyId, name),
        requestDigest: digest(1),
        connection,
        companyId,
        dealId: null,
      },
      seller,
    );
    expect(result).toMatchObject({ kind: "committed", createdPartner: true });
    const { partner, activity } = await partners.get(
      plan.destination.partnerId,
      "2026-10-22",
    );
    expect(partner).toMatchObject({
      name,
      status: "prospect",
      ownerId: staffId,
      models: ["resale"],
    });
    expect(partner.contacts[0]?.source).toMatchObject({ objectId: "5001" });
    expect(activity.map((entry) => entry.eventType)).toEqual(
      expect.arrayContaining(["partner.created", "hubspot.imported"]),
    );
    expect(
      activity.find((e) => e.eventType === "partner.created")?.source,
    ).toBe("hubspot");
    const record = await repo.import(partner.id, plan.operationId);
    expect(record.status).toBe("needs_attention");
    expect(record.items).toHaveLength(1);
    await expect(repo.linkForPartner(partner.id)).resolves.toMatchObject({
      companyId,
      portalId,
    });
  });

  it("returns the first result for a retry and refuses a changed one", async () => {
    const companyId = "910002";
    const name = `Retry ${tag}`;
    const plan = newPlan(name);
    const input = {
      plan,
      snapshot: snapshot(companyId, name),
      requestDigest: digest(2),
      connection,
      companyId,
      dealId: null,
    };
    const first = await repo.commit(input, seller);
    const again = await repo.commit(input, seller);
    expect(again).toMatchObject({
      kind: "replayed",
      importId: plan.operationId,
      partnerId: first.partnerId,
    });
    await expect(
      repo.commit({ ...input, requestDigest: digest(3) }, seller),
    ).rejects.toThrow("HUBSPOT_OPERATION_CONFLICT");
  });

  it("creates exactly one partner when two people bring in one company at once", async () => {
    const companyId = "910003";
    const name = `Concurrent ${tag}`;
    const results = await Promise.all(
      [seller, otherSeller].map((actor, index) =>
        repo.commit(
          {
            plan: newPlan(name),
            snapshot: snapshot(companyId, name),
            requestDigest: digest(4 + index),
            connection,
            companyId,
            dealId: null,
          },
          actor,
        ),
      ),
    );
    const committed = results.filter((r) => r.kind === "committed");
    const lost = results.filter((r) => r.kind === "already_linked");
    expect(committed).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.partnerId).toBe(committed[0]?.partnerId);
    const [row] = await client<{ count: number }[]>`
      select count(*)::int as count from commerce_partners where name = ${name}`;
    expect(row?.count).toBe(1);
  });

  it("updates an existing partner only against the version reviewed", async () => {
    const partner = await partners.save(
      {
        id: randomUUID(),
        name: `Existing ${tag}`,
        website: "https://kept.example",
        status: "signed",
        contacts: [{ name: "Manual Person" }],
      },
      seller,
    );
    createdPartners.push(partner.id);
    const companyId = "910004";
    const plan: HubSpotHandoffPlan = {
      ...newPlan(partner.name),
      destination: {
        kind: "existing_partner",
        partnerId: partner.id,
        name: partner.name,
        expectedVersion: partner.version,
      },
      fields: [
        {
          field: "region",
          action: "add",
          current: "",
          hubspot: "United States",
          result: "United States",
          drift: "never_imported",
          source: {
            property: "country",
            label: "Country",
            value: "United States",
          },
        },
        {
          field: "website",
          action: "keep",
          current: "https://kept.example",
          hubspot: "https://northstar.example",
          result: "https://kept.example",
          drift: "never_imported",
          source: { property: "website", label: "Website", value: null },
        },
      ],
    };
    const base = {
      snapshot: snapshot(companyId, partner.name),
      connection,
      companyId,
      dealId: null,
    };
    await expect(
      repo.commit(
        {
          ...base,
          plan: {
            ...plan,
            operationId: randomUUID(),
            destination: { ...plan.destination, expectedVersion: 99 },
          } as HubSpotHandoffPlan,
          requestDigest: digest(6),
        },
        seller,
      ),
    ).rejects.toThrow("PARTNER_VERSION_CONFLICT");
    await repo.commit({ ...base, plan, requestDigest: digest(7) }, seller);
    const { partner: after } = await partners.get(partner.id, "2026-10-22");
    expect(after).toMatchObject({
      region: "United States",
      website: "https://kept.example",
      status: "signed",
    });
    expect(after.contacts.map((c) => c.name)).toEqual([
      "Manual Person",
      "Ada Okafor",
    ]);
    await expect(repo.fieldHistory(partner.id)).resolves.toMatchObject({
      region: { lastSource: "United States", lastResult: "United States" },
      website: { lastResult: "https://kept.example" },
    });
  });

  it("resolves documents one at a time and never reports open work complete", async () => {
    const companyId = "910005";
    const name = `Documents ${tag}`;
    const plan = newPlan(name, {
      documents: ["8101", "8102"].map((fileId) => ({
        fileId,
        noteId: "6001",
        fileName: `${fileId}.pdf`,
        title: `File ${fileId}`,
        kind: "other" as const,
        size: 100,
        updatedAt: null,
      })),
    });
    await repo.commit(
      {
        plan,
        snapshot: snapshot(companyId, name),
        requestDigest: digest(8),
        connection,
        companyId,
        dealId: null,
      },
      seller,
    );
    const partnerId = plan.destination.partnerId;
    const record = await repo.import(partnerId, plan.operationId);
    const [first, second] = record.items;
    if (!first || !second) throw new Error("items missing");
    const attachment = await documents.add(
      { type: "partner", id: partnerId },
      { id: first.id, title: first.title, kind: "other" },
      {
        fileName: first.fileName,
        bytes: Buffer.from(`%PDF-1.7\n${tag}\n%%EOF`),
      },
      seller,
      { provider: "hubspot", fileId: first.fileId, importId: plan.operationId },
    );
    const failed = await repo.recordItem(
      partnerId,
      plan.operationId,
      second.id,
      { status: "failed", errorCode: "HUBSPOT_DOCUMENT_UNAVAILABLE" },
      seller,
    );
    expect(failed.status).toBe("needs_attention");
    const attached = await repo.recordItem(
      partnerId,
      plan.operationId,
      first.id,
      { status: "attached", attachmentId: attachment.id },
      seller,
    );
    expect(attached.status).toBe("needs_attention");
    await expect(
      repo.recordItem(
        partnerId,
        plan.operationId,
        first.id,
        { status: "failed", errorCode: "HUBSPOT_UNAVAILABLE" },
        seller,
      ),
    ).rejects.toThrow("HUBSPOT_ITEM_RESOLVED");
    const amended = await repo.excludeItem(
      partnerId,
      plan.operationId,
      second.id,
      "Not the signed copy",
      seller,
    );
    expect(amended.status).toBe("completed_with_exclusions");
    expect(amended.completedAt).not.toBeNull();
    await expect(
      repo.attachmentByHash(partnerId, "0".repeat(64)),
    ).resolves.toBeNull();
  });

  it("never reuses or counts a document that was removed from the partner", async () => {
    const companyId = "910007";
    const name = `Removed copy ${tag}`;
    const plan = newPlan(name, {
      documents: ["8201", "8202"].map((fileId) => ({
        fileId,
        noteId: "6001",
        fileName: `${fileId}.pdf`,
        title: `File ${fileId}`,
        kind: "other" as const,
        size: 100,
        updatedAt: null,
      })),
    });
    await repo.commit(
      {
        plan,
        snapshot: snapshot(companyId, name),
        requestDigest: digest(10),
        connection,
        companyId,
        dealId: null,
      },
      seller,
    );
    const partnerId = plan.destination.partnerId;
    const target = { type: "partner" as const, id: partnerId };
    const [first, second] = (await repo.import(partnerId, plan.operationId))
      .items;
    if (!first || !second) throw new Error("items missing");
    const bytes = Buffer.from(`%PDF-1.7\nremoved-${tag}\n%%EOF`);
    const attachment = await documents.add(
      target,
      { id: first.id, title: first.title, kind: "other" },
      { fileName: first.fileName, bytes },
      seller,
    );
    await repo.recordItem(
      partnerId,
      plan.operationId,
      first.id,
      { status: "attached", attachmentId: attachment.id },
      seller,
    );
    await repo.recordItem(
      partnerId,
      plan.operationId,
      second.id,
      { status: "duplicate", existingAttachmentId: attachment.id },
      seller,
    );
    await documents.remove(
      target,
      { id: attachment.id, expectedVersion: 1, reason: "Wrong file" },
      seller,
    );
    const record = await repo.import(partnerId, plan.operationId);
    expect(record.items.find((i) => i.id === first.id)).toMatchObject({
      status: "attached",
      attachmentRemoved: true,
    });
    expect(record.items.find((i) => i.id === second.id)).toMatchObject({
      status: "duplicate",
      existingAttachment: null,
    });
    await expect(
      repo.reuseExisting(partnerId, plan.operationId, second.id, seller),
    ).rejects.toThrow("HUBSPOT_DOCUMENT_REMOVED");
    const { createHash } = await import("node:crypto");
    await expect(
      repo.attachmentByHash(
        partnerId,
        createHash("sha256").update(bytes).digest("hex"),
      ),
    ).resolves.toBeNull();
  });

  it("stops committing reviews read through a connection that changed", async () => {
    const companyId = "910006";
    const name = `Stale ${tag}`;
    await expect(
      repo.commit(
        {
          plan: newPlan(name),
          snapshot: snapshot(companyId, name),
          requestDigest: digest(9),
          connection: { ...connection, version: connection.version + 5 },
          companyId,
          dealId: null,
        },
        seller,
      ),
    ).rejects.toThrow("HUBSPOT_CONNECTION_CHANGED");
  });

  it("finds similar partners by name or website without merging", async () => {
    const similar = await repo.similarPartners({
      name: `Northstar ${tag}`,
      host: "www.northstar.example",
    });
    expect(similar.some((p) => p.reason === "name")).toBe(true);
  });
});
