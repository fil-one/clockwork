// Import, activate, prepare, render and pin, through the real template store,
// renderer and signing repository. The template is a test fixture under a key
// no other run uses, since used versions stay in the database.
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  ContractDocumentStores,
  ContractRepository,
  ContractSigningRepository,
  ContractTemplateRepository,
  PostgresContractDocumentStore,
  createRuntimeDatabase,
} from "@clockwork/db";
import { ContractSigningWorkflow } from "@clockwork/workflows/contracts";
import { fixtureSectionsContent } from "../../../../../../packages/documents/src/__fixtures__/contract-template";
import { prepareInputSchema, preparedSectionsKey } from "./prepare-input";
import { storedTemplateSource } from "./template-source";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

const stores = new ContractDocumentStores(
  new PostgresContractDocumentStore(db),
);
const register = new ContractRepository(db, stores);
const signing = new ContractSigningRepository(db, stores);
const templates = new ContractTemplateRepository(db);
const source = storedTemplateSource(templates);
const admin = { kind: "user" as const, id: randomUUID(), display: "E. Brooks" };
const seller = { kind: "user" as const, id: randomUUID(), display: "R.W." };

/** Prepares a contract from the template version the form was built for. */
async function prepare(key: string, version: string, marker: string) {
  const template = await source.version(key, version);
  const [countersigner] = await signing.countersigners();
  if (!countersigner) throw new Error("A seeded countersigner is required");
  const input = prepareInputSchema(template, new Map()).parse({
    id: randomUUID(),
    templateId: key,
    templateVersion: version,
    counterpartyName: `Bluefin Data ${marker}`,
    effectiveDate: "2026-10-12",
    signerName: "Alex Example",
    signerEmail: `alex.${marker}@example.com`,
    signerTitle: "CEO",
    countersignerId: countersigner.id,
    ownerName: "R.W. Holleman",
    // Schedule D ticked, so its field is asked for; Resale is off, so the
    // margin is not asked for and is dropped.
    sections: ["nfr", "unknown"],
    values: {
      model: "Referral",
      referral_percent: "32.5",
      sample_revenue: "250000",
      resale_margin: "15",
      nfr_capacity: "5 TiB for 60 days",
    },
  });
  expect(input.sections).toEqual(["nfr"]);
  expect(input.values).not.toHaveProperty("resale_margin");
  const signer = {
    name: input.signerName,
    email: input.signerEmail,
    title: input.signerTitle,
  };
  const rendered = await template.render({
    contractId: input.id,
    counterpartyName: input.counterpartyName,
    effectiveDate: input.effectiveDate,
    values: input.values,
    sections: input.sections,
    signer,
    countersigner,
  });
  await signing.prepare(
    {
      contract: {
        id: input.id,
        counterpartyName: input.counterpartyName,
        title: template.name,
        contractType: template.contractType,
        paper: "ours",
        status: "draft",
        effectiveDate: input.effectiveDate,
        initialTermMonths: null,
        autoRenew: false,
        renewalTermMonths: null,
        noticePeriodDays: null,
        valueMinor: null,
        currency: null,
        pricingNotes: "",
        ownerName: input.ownerName,
        internalNotes: "",
        tags: [],
      },
      signing: {
        templateId: template.id,
        templateVersion: template.version,
        templateHash: template.templateHash,
        documentName: `Fil One ${template.name} - ${input.counterpartyName}`,
        input: {
          ...input.values,
          [preparedSectionsKey]: input.sections.join(","),
        },
        counterpartySigner: signer,
        countersignerId: countersigner.id,
        approvalRequired: template.requiresApproval,
        testMode: true,
      },
      pdf: rendered.bytes,
      fileName: "Prepared.pdf",
    },
    seller,
  );
  return { id: input.id, template, rendered };
}

it("prepares from the active stored version and pins it", async () => {
  const key = `test-${randomUUID().slice(0, 8)}`;
  const marker = randomUUID().slice(0, 8);
  const imported = await templates.createDraft(
    { ...fixtureSectionsContent, id: key },
    admin,
    "import",
  );
  await expect(source.active(key)).rejects.toThrow(
    "CONTRACT_TEMPLATE_NOT_FOUND",
  );
  await templates.activate(imported.id, 1, admin);
  expect((await source.listActive()).map((t) => t.id)).toContain(key);

  const { id, template, rendered } = await prepare(key, "v1", marker);
  expect(template.templateHash).toBe(imported.contentHash);
  const record = await register.get(id, "2026-10-12");
  expect(record.signing).toMatchObject({
    templateId: key,
    templateVersion: "v1",
    templateHash: imported.contentHash,
  });
  expect(record.signing?.input[preparedSectionsKey]).toBe("nfr");
  expect(record.files.find((file) => file.kind === "generated")?.sha256).toBe(
    rendered.sha256,
  );
  await expect(templates.get(imported.id)).resolves.toMatchObject({
    usedBy: 1,
  });

  // The used version never changes; a change is a new version.
  await expect(
    client`update commerce_contract_templates set source_note = 'x', revision = revision + 1
      where id = ${imported.id}`,
  ).rejects.toThrow(/cannot change/);
  const next = await templates.createDraft(
    {
      ...fixtureSectionsContent,
      id: key,
      name: "Sections Test Fixture, revised",
    },
    admin,
    "duplicate",
  );
  await templates.activate(next.id, 1, admin);

  // A form built for v1 is refused once v2 is in use, and the database
  // refuses a request pinned to the retired version.
  await expect(prepare(key, "v1", `${marker}b`)).rejects.toThrow(
    "CONTRACT_TEMPLATE_VERSION_CHANGED",
  );
  const [stale] = await client<{ id: string }[]>`
    insert into commerce_contracts (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name)
    values (${randomUUID()}, 'X', 'other', 'ours', 'draft', 'R.W.', ${seller.id}, 'R.W.')
    returning id`;
  await expect(
    client`insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash,
        document_name, input, counterparty_signer, countersigner, preparer_id, preparer_name,
        approval_required, approval_state, test_mode)
      values (${stale?.id ?? ""}, ${key}, 'v1', ${imported.contentHash}, 'Doc', '{}', '{}', '{}',
        ${seller.id}, 'R.W.', false, 'not_required', true)`,
  ).rejects.toThrow(/active version of its template/);
  const second = await prepare(key, "v2", `${marker}c`);
  expect(second.template.name).toBe("Sections Test Fixture, revised");
  await expect(templates.get(imported.id)).resolves.toMatchObject({
    status: "retired",
    usedBy: 1,
  });
}, 60_000);

it("sends a contract again on the version it was prepared from, after that version is replaced", async () => {
  const key = `test-${randomUUID().slice(0, 8)}`;
  const marker = randomUUID().slice(0, 8);
  const v1 = await templates.createDraft(
    { ...fixtureSectionsContent, id: key },
    admin,
    "import",
  );
  await templates.activate(v1.id, 1, admin);
  const { id } = await prepare(key, "v1", marker);
  // Discarded before it reached SignWell, so no provider is called.
  const unavailable = () => Promise.reject(new Error("no provider"));
  await new ContractSigningWorkflow(signing, {
    createContractDraft: unavailable,
    createCounterpartyPaperDraft: unavailable,
    getContract: unavailable,
    send: unavailable,
    remind: unavailable,
    cancel: unavailable,
    updateRecipient: unavailable,
    completedPdf: unavailable,
  }).cancel(id, seller);
  const v2 = await templates.createDraft(
    { ...fixtureSectionsContent, id: key, name: "Sections, revised" },
    admin,
    "duplicate",
  );
  await templates.activate(v2.id, 1, admin);

  const { record } = await signing.resend(
    id,
    1,
    { testMode: true, preparerEmail: null },
    seller,
  );
  expect(record).toMatchObject({
    requestNumber: 2,
    templateVersion: "v1",
    templateHash: v1.contentHash,
  });
  // The ended request and the new one both count as uses of v1.
  await expect(templates.get(v1.id)).resolves.toMatchObject({
    status: "retired",
    usedBy: 2,
  });
}, 60_000);
