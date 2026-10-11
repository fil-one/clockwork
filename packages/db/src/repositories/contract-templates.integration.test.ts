import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createRuntimeDatabase } from "../client";
import { ContractTemplateRepository } from "./contract-templates";

const url =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url,
  role: "clockwork_service",
  ssl: false,
});
const repo = new ContractTemplateRepository(db);
const admin = {
  kind: "user" as const,
  id: randomUUID(),
  display: "Elena Brooks",
};
const other = {
  kind: "user" as const,
  id: randomUUID(),
  display: "Other Admin",
};

afterAll(async () => {
  await client.end();
});

/** Content under a key no other run uses, since used versions stay. */
const content = (key: string, text = "Partner earns [[fee]]% of fees.") => ({
  id: key,
  contractType: "channel_partnership",
  name: "Channel Partnership Agreement",
  requiresApproval: true,
  sourceNote: "Counsel draft 8 Sept 2026, clean",
  fields: [
    {
      id: "fee",
      kind: "percent",
      required: true,
      label: { en: "Referral fee" },
    },
  ],
  document: {
    title: "CHANNEL PARTNERSHIP AGREEMENT",
    blocks: [{ type: "paragraph", text }],
  },
});

const events = async (id: string) =>
  (
    await client<{ event_type: string; after: Record<string, unknown> }[]>`
      select event_type, after from audit_events
      where aggregate_id = ${id} order by aggregate_version`
  ).map((row) => [row.event_type, row.after]);

describe("contract template store", () => {
  it("drafts, edits, activates and retires versions with an audit trail", async () => {
    const key = `test-${randomUUID().slice(0, 8)}`;
    const first = await repo.createDraft(content(key), admin, "import");
    expect(first).toMatchObject({
      key,
      version: 1,
      versionLabel: "v1",
      status: "draft",
      sourceNote: "Counsel draft 8 Sept 2026, clean",
      usedBy: 0,
      revision: 1,
    });
    expect(first.content.sections).toEqual([]);

    const edited = await repo.updateDraft(
      first.id,
      1,
      content(key, "Partner earns [[fee]]% of Year-1 fees."),
      admin,
    );
    expect(edited.contentHash).not.toBe(first.contentHash);
    await expect(
      repo.updateDraft(first.id, 1, content(key), admin),
    ).rejects.toThrow("CONTRACT_TEMPLATE_REVISION_CONFLICT");
    await expect(
      repo.updateDraft(first.id, 2, content(`${key}-x`), admin),
    ).rejects.toThrow("CONTRACT_TEMPLATE_KEY_CHANGED");

    const active = await repo.activate(first.id, 2, admin);
    expect(active).toMatchObject({
      status: "active",
      activatedByName: "Elena Brooks",
      revision: 3,
    });
    await expect(repo.active(key)).resolves.toMatchObject({ id: first.id });
    await expect(
      repo.updateDraft(first.id, 3, content(key), admin),
    ).rejects.toThrow("CONTRACT_TEMPLATE_NOT_DRAFT");

    // A new version is drafted from the active one; activating it retires v1.
    const second = await repo.createDraft(active.content, other, "duplicate");
    expect(second).toMatchObject({ version: 2, status: "draft" });
    expect(second.contentHash).toBe(active.contentHash);
    const replaced = await repo.activate(second.id, 1, other);
    expect(replaced.status).toBe("active");
    await expect(repo.get(first.id)).resolves.toMatchObject({
      status: "retired",
      retiredByName: "Other Admin",
    });
    await expect(repo.active(key)).resolves.toMatchObject({ id: second.id });

    // A retired version can be put back into use.
    await repo.activate(first.id, 4, admin);
    await expect(repo.active(key)).resolves.toMatchObject({ id: first.id });
    await repo.retire(first.id, 5, admin);
    await expect(repo.active(key)).resolves.toBeNull();
    expect((await repo.list()).filter((row) => row.key === key)).toHaveLength(
      2,
    );

    expect((await events(first.id)).map(([type]) => type)).toEqual([
      "contract_template.created",
      "contract_template.updated",
      "contract_template.activated",
      "contract_template.retired",
      "contract_template.activated",
      "contract_template.retired",
    ]);
    expect((await events(first.id))[0]?.[1]).toMatchObject({
      templateKey: key,
      version: "v1",
      origin: "import",
    });
    expect((await events(second.id))[1]?.[1]).toMatchObject({
      status: "active",
      replaced: "v1",
    });
  });

  it("discards an unused draft and returns a retried create", async () => {
    const key = `test-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const draft = await repo.createDraft(content(key), admin, "blank", id);
    await expect(
      repo.createDraft(content(key), admin, "blank", id),
    ).resolves.toMatchObject({ id, version: 1 });
    await expect(
      repo.createDraft(content(key), other, "blank", id),
    ).rejects.toThrow("CONTRACT_TEMPLATE_IDEMPOTENCY_CONFLICT");
    await repo.discard(draft.id, 1, admin);
    await expect(repo.get(draft.id)).rejects.toThrow(
      "CONTRACT_TEMPLATE_NOT_FOUND",
    );
    expect((await events(id)).map(([type]) => type)).toEqual([
      "contract_template.created",
      "contract_template.discarded",
    ]);
  });

  it("never gives a discarded draft's version number out again", async () => {
    const key = `test-${randomUUID().slice(0, 8)}`;
    const first = await repo.createDraft(content(key), admin, "import");
    const second = await repo.createDraft(content(key), admin, "duplicate");
    await repo.discard(second.id, 1, admin);
    await expect(
      repo.createDraft(content(key), admin, "import"),
    ).resolves.toMatchObject({ version: 3 });
    expect((await events(second.id))[1]?.[1]).toMatchObject({
      version: "v2",
      content: { document: { title: "CHANNEL PARTNERSHIP AGREEMENT" } },
    });
    expect(first.version).toBe(1);
  });

  it("keeps one unusable stored version from hiding the others", async () => {
    const good = `test-${randomUUID().slice(0, 8)}`;
    const bad = `test-${randomUUID().slice(0, 8)}`;
    const kept = await repo.createDraft(content(good), admin, "import");
    await repo.activate(kept.id, 1, admin);
    const broken = await repo.createDraft(content(bad), admin, "import");
    await repo.activate(broken.id, 1, admin);
    // Stored content changed behind the store's back (triggers bypassed).
    const owner = postgres(url, { max: 1 });
    await owner.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`update commerce_contract_templates set content_hash = ${"0".repeat(64)}
        where id = ${broken.id}`;
    });
    await owner.end();
    const active = (await repo.listActive()).map((row) => row.key);
    expect(active).toContain(good);
    expect(active).not.toContain(bad);
    await expect(repo.get(broken.id)).resolves.toMatchObject({
      problem: "CONTRACT_TEMPLATE_INTEGRITY",
    });
    await expect(repo.active(bad)).rejects.toThrow(
      "CONTRACT_TEMPLATE_INTEGRITY",
    );
    // It can still be retired.
    await expect(repo.retire(broken.id, 2, admin)).resolves.toMatchObject({
      status: "retired",
    });
  });

  it("refuses content that does not validate", async () => {
    const broken = content(`test-${randomUUID().slice(0, 8)}`, "[[missing]]");
    await expect(repo.createDraft(broken, admin, "import")).rejects.toThrow(
      /undeclared token/,
    );
  });
});
