// End to end through the real database, the real renderer and the real
// SignWell client, with only SignWell's HTTP API simulated. The template is
// the test-only fixture; it is never registered in production.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import type { TemplateLineItems } from "@clockwork/contracts";
import {
  ContractDocumentStores,
  ContractRepository,
  ContractSigningRepository,
  PostgresContractDocumentStore,
  createRuntimeDatabase,
} from "@clockwork/db";
import {
  SignWellContractClient,
  verifySignWellWakeup,
} from "@clockwork/integrations";
import { ContractSigningWorkflow } from "@clockwork/workflows/contracts";
import {
  availableContractTemplate,
  counterpartySignaturePageVersion,
  renderCounterpartyPaper,
} from "@clockwork/documents";
import { fixtureContractTemplateRegistry } from "../../../../../../packages/documents/src/__fixtures__/contract-template";
import { rateMinimums } from "./line-items";
import { prepareInputSchema } from "./prepare-input";
import { POST as signWellWebhook } from "../../../../app/api/v1/webhooks/signwell/route";

// The webhook route as deployed, wired to this file's database and fake.
const wired = vi.hoisted((): { workflow: unknown; repository: unknown } => ({
  workflow: null,
  repository: null,
}));
vi.mock("@/src/features/internal-ops/mnda/server", () => ({
  mndaRepository: () => ({ byProvider: () => Promise.resolve(null) }),
  mndaWorkflow: () => ({}),
}));
vi.mock("@/src/features/internal-ops/contracts/server", () => ({
  contractSigningRepository: () => wired.repository,
  contractSigningWorkflow: () => wired.workflow,
}));

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

// The fixture's line-item table: one row at the rate's list price.
const fixtureLines = {
  currency: "USD",
  rows: [
    {
      sku: "STORAGE-TB",
      description: "Hot storage",
      region: "us-east",
      unit: "TB-month",
      quantity: "500",
      termMonths: 12,
      unitPriceMinor: "1500",
      minimumQuantity: "10",
      discountBps: 1000,
      extendedMinor: "8100000",
    },
  ],
} satisfies TemplateLineItems;
// The in-force rate for that row, whose minimum the server applies.
const minimums = rateMinimums([
  {
    rateCards: [
      {
        sku: "STORAGE-TB",
        region: "us-east",
        unit: "TB-month",
        minimumQuantity: "100",
      },
    ],
  },
]);

interface FakeDocument {
  id: string;
  status: string;
  test_mode: boolean;
  metadata: Record<string, string>;
  recipients: {
    id: string;
    email: string;
    name: string;
    status: string | null;
    bounced?: boolean;
  }[];
  fields: { recipient_id: string; type: string; required: boolean }[][];
  apply_signing_order: boolean;
}

/** SignWell's document API, reduced to what the workflow calls. */
function fakeSignWell() {
  const documents = new Map<string, FakeDocument>();
  const calls: string[] = [];
  const uploads: Buffer[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  const respond = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const path = url.pathname.replace("/api/v1/", "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (method === "POST" && path === "documents") {
      const body = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as {
        test_mode: boolean;
        draft: boolean;
        metadata: Record<string, string>;
        recipients: { id: string; email: string; name: string }[];
        apply_signing_order: boolean;
        files: { file_base64: string }[];
      };
      expect(body.draft).toBe(true);
      uploads.push(Buffer.from(body.files[0]?.file_base64 ?? "", "base64"));
      expect(
        Buffer.from(body.files[0]?.file_base64 ?? "", "base64")
          .subarray(0, 5)
          .toString(),
      ).toBe("%PDF-");
      const document: FakeDocument = {
        id: randomUUID(),
        status: "Created",
        test_mode: body.test_mode,
        metadata: body.metadata,
        recipients: body.recipients.map((r) => ({ ...r, status: null })),
        fields: [
          body.recipients.flatMap((r) =>
            ["signature", "autofill_date_signed"].map((type) => ({
              recipient_id: r.id,
              type,
              required: true,
            })),
          ),
        ],
        apply_signing_order: body.apply_signing_order,
      };
      documents.set(document.id, document);
      return json(document);
    }
    const [, id, action] = /^documents\/([^/]+)(?:\/(.+))?$/.exec(path) ?? [];
    const document = documents.get(id ?? "");
    if (!document) return new Response(null, { status: 404 });
    if (!action && method === "DELETE") {
      documents.delete(document.id);
      return new Response(null, { status: 204 });
    }
    if (!action) {
      // Text-tag extraction finishes after the first read.
      const current = structuredClone(document);
      if (document.status === "Created") document.status = "Draft";
      return json(current);
    }
    if (action === "send" && method === "POST") {
      document.status = "Sent";
      return json({});
    }
    if (action === "remind" && method === "POST") return json({});
    if (action === "recipients" && method === "PATCH") {
      const body = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as { recipients: { id: string; email: string; name: string }[] };
      for (const change of body.recipients) {
        const recipient = document.recipients.find((r) => r.id === change.id);
        if (recipient) Object.assign(recipient, { ...change, bounced: false });
      }
      return json(document);
    }
    if (action.startsWith("completed_pdf"))
      return new Response(
        Buffer.from("%PDF-1.7\nexecuted with audit trail\n%%EOF"),
      );
    return new Response(null, { status: 400 });
  };
  const transport: typeof fetch = (input, init) =>
    Promise.resolve(respond(input, init));
  return { transport, documents, calls, uploads };
}

function wakeup(providerId: string, secret: string) {
  const time = Math.floor(Date.now() / 1000);
  const type = "document_completed";
  return JSON.stringify({
    event: {
      type,
      time,
      hash: createHmac("sha256", secret)
        .update(`${type}@${time}`)
        .digest("hex"),
    },
    data: { object: { id: providerId } },
  });
}

it("prepares from a template, enforces two-person approval, sends, and archives the executed PDF", async () => {
  const template = availableContractTemplate(
    fixtureContractTemplateRegistry,
    "test-fixture",
  );
  const [countersigner] = await signing.countersigners();
  if (!countersigner) throw new Error("A seeded countersigner is required");
  const preparer = { kind: "user" as const, id: randomUUID(), display: "R.W." };
  const approver = {
    kind: "user" as const,
    id: randomUUID(),
    display: "James",
  };
  const marker = randomUUID().slice(0, 8);

  // 1. Prepare: the seller's values are validated against the template.
  const input = prepareInputSchema(template.fields, minimums).parse({
    id: randomUUID(),
    templateId: template.id,
    counterpartyName: `Bluefin Data ${marker}`,
    effectiveDate: "2026-10-05",
    signerName: "Alex Example",
    signerEmail: `Alex.${marker}@Example.com`,
    signerTitle: "CEO",
    countersignerId: countersigner.id,
    ownerName: "R.W. Holleman",
    values: {
      fixture_reference: "REF-7",
      fixture_tier: "beta",
      fixture_lines: fixtureLines,
    },
  });
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
    signer,
    countersigner,
  });
  const documentName = `Fil One ${template.name} - ${input.counterpartyName}`;
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
        documentName,
        input: input.values,
        counterpartySigner: signer,
        countersignerId: countersigner.id,
        approvalRequired: template.requiresApproval,
        testMode: true,
      },
      pdf: rendered.bytes,
      fileName: `${documentName}.pdf`,
    },
    preparer,
  );
  const prepared = await register.get(input.id, "2026-10-05");
  const generated = prepared.files.find((f) => f.kind === "generated");
  expect(generated?.sha256).toBe(rendered.sha256);
  expect(prepared.signing).toMatchObject({
    approvalState: "pending",
    templateHash: template.templateHash,
    // The table is stored with the other values, with the in-force rate's
    // minimum in place of the "10" the browser sent.
    input: {
      fixture_lines: {
        ...fixtureLines,
        rows: [{ ...fixtureLines.rows[0], minimumQuantity: "100" }],
      },
    },
  });

  // 2. Sending before approval never reaches SignWell.
  const signWell = fakeSignWell();
  const workflow = new ContractSigningWorkflow(
    signing,
    new SignWellContractClient("test-key", signWell.transport),
    () => Promise.resolve(),
  );
  await expect(workflow.send(input.id, preparer)).rejects.toThrow(
    "CONTRACT_APPROVAL_REQUIRED",
  );
  expect(signWell.calls).toEqual([]);

  // 3. The preparer cannot approve; someone else can.
  await expect(
    workflow.decide(input.id, { approve: true }, preparer),
  ).rejects.toThrow("CONTRACT_APPROVER_IS_PREPARER");
  await workflow.decide(input.id, { approve: true }, approver);

  // 4. Send: an unsent draft is bound, then sent once.
  const sent = await workflow.send(input.id, preparer);
  expect(sent.state).toBe("sent");
  expect(signWell.calls.filter((c) => c.endsWith("/send"))).toHaveLength(1);
  const [document] = [...signWell.documents.values()];
  if (!document) throw new Error("SignWell document missing");
  expect(document.recipients.map((r) => r.id)).toEqual([
    "counterparty",
    "fil-one",
  ]);
  expect((await register.get(input.id, "2026-10-05")).contract.status).toBe(
    "out_for_signature",
  );

  // 5. Webhook wakeups re-read SignWell; the callback body is never trusted.
  const secret = "webhook-secret";
  const counterparty = document.recipients[0];
  if (!counterparty) throw new Error("recipient missing");
  counterparty.status = "signed";
  const providerId = verifySignWellWakeup(wakeup(document.id, secret), secret);
  const bound = await signing.byProvider(providerId);
  expect(bound?.contractId).toBe(input.id);
  expect(
    (await workflow.sync(input.id, { kind: "provider", id: "signwell" })).state,
  ).toBe("awaiting_countersignature");
  document.status = "Completed";
  expect(
    (await workflow.sync(input.id, { kind: "provider", id: "signwell" })).state,
  ).toBe("completed");

  // 6. The executed PDF is archived through the document store and verified.
  const done = await register.get(input.id, "2026-10-05");
  expect(done.contract.status).toBe("executed");
  const executed = done.files.find((f) => f.kind === "executed");
  if (!executed) throw new Error("executed copy missing");
  expect(executed.fileName).toBe(
    `Fil One Engine Test Fixture - Bluefin Data ${marker} (executed).pdf`,
  );
  const { bytes } = await register.readFile(input.id, executed.id);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    executed.sha256,
  );
  expect(bytes.toString()).toContain("executed with audit trail");
  expect(done.activity.map((a) => a.eventType)).toEqual(
    expect.arrayContaining([
      "contract.prepared",
      "contract.approved",
      "contract.signing_sent",
      "contract.signing_awaiting_countersignature",
      "contract.signing_completed",
    ]),
  );
  // A later wakeup for a finished contract changes nothing.
  expect(
    (await workflow.sync(input.id, { kind: "provider", id: "signwell" })).state,
  ).toBe("completed");
}, 60_000);

/** A contract prepared from the fixture template, approved and ready to send. */
async function preparedContract(preparer: {
  kind: "user";
  id: string;
  display: string;
}) {
  const template = availableContractTemplate(
    fixtureContractTemplateRegistry,
    "test-fixture",
  );
  const [countersigner] = await signing.countersigners();
  if (!countersigner) throw new Error("A seeded countersigner is required");
  const marker = randomUUID().slice(0, 8);
  const id = randomUUID();
  const signer = {
    name: "Alex Example",
    email: `alex.${marker}@example.com`,
    title: "CEO",
  };
  const { values } = prepareInputSchema(template.fields, minimums).parse({
    id,
    templateId: template.id,
    counterpartyName: `Deleted Data ${marker}`,
    effectiveDate: "2026-10-09",
    signerName: signer.name,
    signerEmail: signer.email,
    signerTitle: signer.title,
    countersignerId: countersigner.id,
    ownerName: "R.W. Holleman",
    values: {
      fixture_reference: "REF-8",
      fixture_tier: "beta",
      fixture_lines: fixtureLines,
    },
  });
  const rendered = await template.render({
    contractId: id,
    counterpartyName: `Deleted Data ${marker}`,
    effectiveDate: "2026-10-09",
    values,
    signer,
    countersigner,
  });
  const documentName = `Fil One ${template.name} - Deleted Data ${marker}`;
  await signing.prepare(
    {
      contract: {
        id,
        counterpartyName: `Deleted Data ${marker}`,
        title: template.name,
        contractType: template.contractType,
        paper: "ours",
        status: "draft",
        effectiveDate: "2026-10-09",
        initialTermMonths: null,
        autoRenew: false,
        renewalTermMonths: null,
        noticePeriodDays: null,
        valueMinor: null,
        currency: null,
        pricingNotes: "",
        ownerName: "R.W. Holleman",
        internalNotes: "",
        tags: [],
      },
      signing: {
        templateId: template.id,
        templateVersion: template.version,
        templateHash: template.templateHash,
        documentName,
        input: values,
        counterpartySigner: signer,
        countersignerId: countersigner.id,
        approvalRequired: template.requiresApproval,
        testMode: true,
      },
      pdf: rendered.bytes,
      fileName: `${documentName}.pdf`,
    },
    preparer,
  );
  if (template.requiresApproval)
    await signing.decide(
      id,
      { approve: true },
      { kind: "user", id: randomUUID(), display: "Approver" },
    );
  return id;
}

it("survives a document deleted in SignWell: wakeups succeed, staff see it, and voiding closes it", async () => {
  const preparer = { kind: "user" as const, id: randomUUID(), display: "R.W." };
  const id = await preparedContract(preparer);
  const signWell = fakeSignWell();
  const workflow = new ContractSigningWorkflow(
    signing,
    new SignWellContractClient("test-key", signWell.transport),
    () => Promise.resolve(),
  );
  await workflow.send(id, preparer);
  const [document] = [...signWell.documents.values()];
  if (!document) throw new Error("SignWell document missing");

  // A reminder is recorded; a second one within the minute is refused even
  // though nothing else changed.
  const reminded = await workflow.remind(id, preparer);
  expect(reminded.remindedAt).not.toBeNull();
  await expect(workflow.remind(id, preparer)).rejects.toThrow(
    "CONTRACT_REMINDER_TOO_SOON",
  );
  expect(signWell.calls.filter((c) => c.endsWith("/remind"))).toHaveLength(1);

  // Someone deletes the document in SignWell. The next wakeup answers 200
  // and the request waits for a person instead of failing every retry.
  signWell.documents.delete(document.id);
  const secret = "webhook-secret";
  vi.stubEnv("SIGNWELL_WEBHOOK_ID", secret);
  wired.workflow = workflow;
  wired.repository = signing;
  const response = await signWellWebhook(
    new Request("https://commerce.fil.one/api/v1/webhooks/signwell", {
      method: "POST",
      body: wakeup(document.id, secret),
    }),
  );
  vi.unstubAllEnvs();
  expect(response.status).toBe(200);
  const flagged = await register.get(id, "2026-10-09");
  expect(flagged.signing).toMatchObject({
    state: "attention",
    error: "deleted_in_signwell",
  });
  expect(flagged.contract.status).toBe("out_for_signature");
  await expect(
    workflow.sync(id, { kind: "provider", id: "signwell" }),
  ).resolves.toMatchObject({ state: "attention" });

  // Voiding closes it without another delete call; the register row returns
  // to draft and the history keeps the reason.
  const deletes = signWell.calls.filter((c) => c.startsWith("DELETE"));
  await expect(
    workflow.void(id, preparer, {
      reason: "Deleted in SignWell by mistake",
    }),
  ).resolves.toMatchObject({ state: "canceled" });
  expect(signWell.calls.filter((c) => c.startsWith("DELETE"))).toEqual(deletes);
  const closed = await register.get(id, "2026-10-09");
  expect(closed.contract.status).toBe("draft");
  expect(closed.activity.map((a) => a.eventType)).toEqual(
    expect.arrayContaining([
      "contract.reminded",
      "contract.deleted_in_signwell",
      "contract.voided",
    ]),
  );
  expect(closed.activity[0]).toMatchObject({
    eventType: "contract.voided",
    changes: { reason: "Deleted in SignWell by mistake" },
  });
}, 60_000);

it("voids a sent contract in SignWell and in the register", async () => {
  const preparer = { kind: "user" as const, id: randomUUID(), display: "R.W." };
  const id = await preparedContract(preparer);
  const signWell = fakeSignWell();
  const workflow = new ContractSigningWorkflow(
    signing,
    new SignWellContractClient("test-key", signWell.transport),
    () => Promise.resolve(),
  );
  await workflow.send(id, preparer);
  await expect(workflow.cancel(id, preparer)).rejects.toThrow(
    "CONTRACT_VOID_REQUIRED",
  );
  const voided = await workflow.void(id, preparer, {
    reason: "Wrong legal entity",
  });
  expect(voided).toMatchObject({
    state: "canceled",
    cancelCode: "voided",
    cancelReason: "Wrong legal entity",
  });
  expect(signWell.documents.size).toBe(0);
  expect(signWell.calls.filter((c) => c.startsWith("DELETE"))).toHaveLength(1);
  const detail = await register.get(id, "2026-10-09");
  expect(detail.contract.status).toBe("draft");
  expect(detail.activity[0]).toMatchObject({
    eventType: "contract.voided",
    changes: {
      status: { from: "out_for_signature", to: "draft" },
      reason: "Wrong legal entity",
    },
  });
}, 60_000);

it("fixes a bounced counterparty email, then voids for a different signer", async () => {
  const preparer = { kind: "user" as const, id: randomUUID(), display: "R.W." };
  const id = await preparedContract(preparer);
  const signWell = fakeSignWell();
  const workflow = new ContractSigningWorkflow(
    signing,
    new SignWellContractClient("test-key", signWell.transport),
    () => Promise.resolve(),
  );
  await workflow.send(id, preparer);
  const [document] = [...signWell.documents.values()];
  const counterparty = document?.recipients[0];
  if (!counterparty) throw new Error("SignWell document missing");
  const original = counterparty.email;

  // SignWell reports the bounce; the request waits in attention.
  counterparty.bounced = true;
  await expect(workflow.sync(id, preparer)).resolves.toMatchObject({
    state: "attention",
    error: "recipient_bounced",
  });

  // The correction is recorded pending, sent to SignWell, then confirmed.
  await expect(
    workflow.correctSigner(id, preparer, "right@example.com"),
  ).resolves.toMatchObject({
    state: "sent",
    error: null,
    correctedSignerEmail: "right@example.com",
    pendingSignerEmail: null,
  });
  expect(signWell.calls).toContain(`PATCH documents/${document.id}/recipients`);
  expect(counterparty.email).toBe("right@example.com");
  const corrected = await register.get(id, "2026-10-09");
  // Newest first: the request left attention once SignWell confirmed.
  expect(corrected.activity.slice(0, 3)).toMatchObject([
    { eventType: "contract.signing_sent" },
    {
      eventType: "contract.signer_corrected",
      changes: {
        signerEmail: { from: original, to: "right@example.com" },
      },
    },
    {
      eventType: "contract.signer_correction_requested",
      changes: {
        signerEmail: { from: original, to: "right@example.com" },
      },
    },
  ]);
  // The replaced address is the audit events' before-image, once.
  const audit = await client<{ before: unknown; after: unknown }[]>`
    select before, after from audit_events
    where aggregate_id = ${id} and event_type = 'contract.signer_corrected'`;
  expect(audit).toEqual([
    {
      before: { signerEmail: original },
      after: {
        eventType: "contract.signer_corrected",
        fields: ["signerEmail"],
        signerEmail: "right@example.com",
      },
    },
  ]);

  // A different person will sign: the void keeps the code and no reason.
  await expect(
    workflow.void(id, preparer, { code: "signer_change" }),
  ).resolves.toMatchObject({
    state: "canceled",
    cancelCode: "signer_change",
    cancelReason: null,
    correctedSignerEmail: "right@example.com",
  });
  expect(signWell.documents.size).toBe(0);
  const closed = await register.get(id, "2026-10-09");
  expect(closed.contract.status).toBe("draft");
  expect(closed.activity[0]).toMatchObject({
    eventType: "contract.voided",
    changes: { cancelCode: "signer_change" },
  });
}, 60_000);

it("sends counterparty paper they signed already to Fil One alone and archives it", async () => {
  const preparer = { kind: "user" as const, id: randomUUID(), display: "R.W." };
  const approver = { kind: "user" as const, id: randomUUID(), display: "J." };
  const marker = randomUUID().slice(0, 8);
  const id = randomUUID();
  // Their signed PDF: any real PDF from another writer will do.
  const theirs = await availableContractTemplate(
    fixtureContractTemplateRegistry,
    "test-fixture",
  ).render({
    contractId: id,
    counterpartyName: "Their Co",
    effectiveDate: "2026-10-01",
    values: {
      fixture_reference: "THEIRS",
      fixture_tier: "beta",
      fixture_note: "",
      fixture_lines: fixtureLines,
    },
    signer: { name: "Pat", email: "pat@example.com", title: "CEO" },
    countersigner: { name: "Sam", email: "sam@example.com", title: "CFO" },
  });
  await register.create(
    {
      id,
      counterpartyName: `Paper Data ${marker}`,
      title: "Reseller agreement",
      contractType: "channel_partnership",
      paper: "theirs",
      status: "in_negotiation",
      effectiveDate: null,
      initialTermMonths: null,
      autoRenew: false,
      renewalTermMonths: null,
      noticePeriodDays: null,
      valueMinor: null,
      currency: null,
      pricingNotes: "",
      ownerName: "R.W. Holleman",
      internalNotes: "",
      tags: [],
    },
    preparer,
  );
  const file = await register.addFile(
    id,
    {
      kind: "counterparty_draft",
      fileName: "Signed by them.pdf",
      bytes: theirs.bytes,
    },
    preparer,
  );
  const [countersigner] = await signing.countersigners();
  if (!countersigner) throw new Error("A seeded countersigner is required");
  const rendered = await renderCounterpartyPaper(theirs.bytes, {
    contractId: id,
    counterpartyName: `Paper Data ${marker}`,
    sourceSha256: file.sha256,
    counterpartySigner: null,
    countersigner,
    preparedOn: "2026-10-10",
  });
  await signing.prepareCounterpartyPaper(
    {
      contractId: id,
      source: { fileId: file.id, sha256: file.sha256 },
      documentName: `Fil One countersignature - Paper Data ${marker}`,
      signaturePageVersion: counterpartySignaturePageVersion,
      counterpartySigner: null,
      countersignerId: countersigner.id,
      testMode: true,
      pdf: rendered.bytes,
      fileName: "Countersignature.pdf",
    },
    preparer,
  );

  const signWell = fakeSignWell();
  const workflow = new ContractSigningWorkflow(
    signing,
    new SignWellContractClient("test-key", signWell.transport),
    () => Promise.resolve(),
  );
  await expect(workflow.send(id, preparer)).rejects.toThrow(
    "CONTRACT_APPROVAL_REQUIRED",
  );
  await workflow.decide(id, { approve: true }, approver);
  await expect(workflow.send(id, preparer)).resolves.toMatchObject({
    state: "sent",
  });
  const [document] = [...signWell.documents.values()];
  if (!document) throw new Error("SignWell document missing");
  // Fil One alone signs the merged PDF, bound to their PDF's hash.
  expect(document.recipients.map((r) => r.id)).toEqual(["fil-one"]);
  expect(document.metadata.template_sha256).toBe(file.sha256);
  expect(signWell.uploads[0]?.equals(rendered.bytes)).toBe(true);

  await workflow.remind(id, preparer);
  document.status = "Completed";
  expect((await workflow.sync(id, preparer)).state).toBe("completed");
  const done = await register.get(id, "2026-10-10");
  expect(done.contract.status).toBe("executed");
  expect(done.files.map((f) => f.kind).sort()).toEqual([
    "counterparty_draft",
    "executed",
    "generated",
  ]);
  expect(done.activity.map((a) => a.eventType)).toEqual(
    expect.arrayContaining([
      "contract.prepared",
      "contract.approved",
      "contract.reminded",
      "contract.signing_completed",
    ]),
  );
}, 60_000);

it("sends a voided contract again as a new SignWell document and completes it", async () => {
  const preparer = { kind: "user" as const, id: randomUUID(), display: "R.W." };
  const approver = { kind: "user" as const, id: randomUUID(), display: "J." };
  const id = await preparedContract(preparer);
  const signWell = fakeSignWell();
  const workflow = new ContractSigningWorkflow(
    signing,
    new SignWellContractClient("test-key", signWell.transport),
    () => Promise.resolve(),
  );
  const first = await workflow.send(id, preparer);
  const firstDocument = first.providerId;
  await workflow.void(id, preparer, { reason: "Sent before pricing call" });

  const { record } = await signing.resend(
    id,
    1,
    { testMode: true, preparerEmail: null },
    preparer,
  );
  expect(record).toMatchObject({
    requestNumber: 2,
    state: "draft",
    providerId: null,
  });
  // The ended request's SignWell document no longer wakes the contract.
  await expect(signing.byProvider(firstDocument ?? "")).resolves.toBeNull();
  await expect(workflow.send(id, preparer)).rejects.toThrow(
    "CONTRACT_APPROVAL_REQUIRED",
  );
  await workflow.decide(id, { approve: true }, approver);
  const sent = await workflow.send(id, preparer);
  expect(sent.state).toBe("sent");
  expect(sent.providerId).not.toBe(firstDocument);
  // The same prepared PDF went to SignWell both times.
  expect(signWell.uploads).toHaveLength(2);
  expect(
    signWell.uploads[1]?.equals(signWell.uploads[0] ?? Buffer.alloc(0)),
  ).toBe(true);
  const document = signWell.documents.get(sent.providerId ?? "");
  if (!document) throw new Error("SignWell document missing");
  expect(document.metadata.commerce_contract_id).toBe(id);
  document.status = "Completed";
  expect((await workflow.sync(id, preparer)).state).toBe("completed");
  const done = await register.get(id, "2026-10-10");
  expect(done.contract.status).toBe("executed");
  expect(done.previousSigning).toEqual([
    expect.objectContaining({
      requestNumber: 1,
      state: "canceled",
      cancelReason: "Sent before pricing call",
    }),
  ]);
  // A completed request is never replaced.
  await expect(
    signing.resend(id, 2, { testMode: true, preparerEmail: null }, preparer),
  ).rejects.toThrow("CONTRACT_PAPER_NOT_SENDABLE");
}, 60_000);
