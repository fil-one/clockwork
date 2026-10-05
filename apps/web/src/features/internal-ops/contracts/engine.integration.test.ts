// End to end through the real database, the real renderer and the real
// SignWell client, with only SignWell's HTTP API simulated. The template is
// the test-only fixture; it is never registered in production.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
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
import { availableContractTemplate } from "@clockwork/documents";
import { fixtureContractTemplateRegistry } from "../../../../../../packages/documents/src/__fixtures__/contract-template";
import { prepareInputSchema } from "./prepare-input";

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
  }[];
  fields: { recipient_id: string; type: string; required: boolean }[][];
  apply_signing_order: boolean;
}

/** SignWell's document API, reduced to what the workflow calls. */
function fakeSignWell() {
  const documents = new Map<string, FakeDocument>();
  const calls: string[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v1/", "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (method === "POST" && path === "documents") {
      const body = JSON.parse(String(init?.body)) as {
        test_mode: boolean;
        draft: boolean;
        metadata: Record<string, string>;
        recipients: { id: string; email: string; name: string }[];
        apply_signing_order: boolean;
        files: { file_base64: string }[];
      };
      expect(body.draft).toBe(true);
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
    if (action.startsWith("completed_pdf"))
      return new Response(
        Buffer.from("%PDF-1.7\nexecuted with audit trail\n%%EOF"),
      );
    return new Response(null, { status: 400 });
  };
  return { transport, documents, calls };
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
  const input = prepareInputSchema(template.fields).parse({
    id: randomUUID(),
    templateId: template.id,
    counterpartyName: `Bluefin Data ${marker}`,
    effectiveDate: "2026-10-05",
    signerName: "Alex Example",
    signerEmail: `Alex.${marker}@Example.com`,
    signerTitle: "CEO",
    countersignerId: countersigner.id,
    ownerName: "R.W. Holleman",
    values: { fixture_reference: "REF-7", fixture_tier: "beta" },
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
