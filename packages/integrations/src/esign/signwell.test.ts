import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fixtureRecord } from "../../../contracts/src/mnda-fixture";
import {
  assertSignWellCopiedContacts,
  assertSignWellSigningFields,
  signWellRefused,
  SignWellClient,
  signWellAttentionReason,
  signWellState,
  verifySignWellWakeup,
  type SignWellDocument,
} from "./signwell";

const providerId = "019a44ac-0000-7000-8000-000000000004";
const doc = (): SignWellDocument => ({
  id: providerId,
  status: "Draft",
  test_mode: true,
  metadata: {
    commerce_mnda_id: fixtureRecord.id,
    template_sha256: fixtureRecord.templateHash,
  },
  recipients: [
    {
      id: "counterparty",
      email: fixtureRecord.input.signerEmail,
      name: "Alex",
    },
    { id: "fil-one", email: fixtureRecord.countersigner.email, name: "James" },
  ],
  apply_signing_order: true,
  fields: [
    [
      ...["counterparty", "fil-one"].flatMap((recipient_id) =>
        ["signature", "autofill_date_signed"].map((type) => ({
          recipient_id,
          type,
          required: true,
        })),
      ),
    ],
  ],
});
describe("SignWell MNDA contract", () => {
  it("creates an unsent two-party draft and requires extracted signing fields", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(doc())));
    await new SignWellClient("private-key", transport).createDraft(
      fixtureRecord,
      Buffer.from("%PDF-test"),
    );
    const rawBody = transport.mock.calls[0]?.[1]?.body;
    if (typeof rawBody !== "string")
      throw new Error("Expected JSON request body");
    const body = JSON.parse(rawBody) as { recipients: { email: string }[] };
    expect(body).toMatchObject({
      draft: true,
      test_mode: true,
      apply_signing_order: true,
      text_tags: true,
      allow_reassign: false,
    });
    expect(body.recipients.map((r: { email: string }) => r.email)).toEqual([
      fixtureRecord.input.signerEmail,
      fixtureRecord.countersigner.email,
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(() => assertSignWellSigningFields(doc())).not.toThrow();
    expect(() => assertSignWellSigningFields({ ...doc(), fields: [] })).toThrow(
      "SIGNING_FIELDS",
    );
    expect(() =>
      assertSignWellSigningFields({ ...doc(), apply_signing_order: false }),
    ).toThrow("SIGNING_ORDER");
  });
  it("requires identity, environment, template and recipient bindings", () => {
    expect(signWellState(doc(), fixtureRecord)).toBe("ready");
    expect(signWellState({ ...doc(), status: "Created" }, fixtureRecord)).toBe(
      "preparing",
    );
    expect(() =>
      signWellState({ ...doc(), test_mode: false }, fixtureRecord),
    ).toThrow("BINDING");
    expect(() =>
      signWellState({ ...doc(), recipients: [] }, fixtureRecord),
    ).toThrow("SIGNERS");
    expect(() =>
      signWellState(doc(), { ...fixtureRecord, providerId: fixtureRecord.id }),
    ).toThrow("BINDING");
    expect(
      signWellState({ ...doc(), status: "Manually completed" }, fixtureRecord),
    ).toBe("attention");
    expect(
      signWellState({ ...doc(), status: "Completed" }, fixtureRecord),
    ).toBe("completed");
    const waiting = doc();
    waiting.status = "Sent";
    if (waiting.recipients[0]) waiting.recipients[0].status = "signed";
    expect(signWellState(waiting, fixtureRecord)).toBe(
      "awaiting_countersignature",
    );
  });
  it("authenticates webhook wakeups, rejects stale/tampered MACs, and never trusts completion payloads", () => {
    const time = 1_800_000_000,
      type = "document_completed";
    const hash = createHmac("sha256", "hook-id")
      .update(`${type}@${time}`)
      .digest("hex");
    const event = {
      event: { type, time, hash },
      data: { object: { id: providerId, status: "completed" } },
    };
    expect(
      verifySignWellWakeup(JSON.stringify(event), "hook-id", time * 1000),
    ).toBe(providerId);
    expect(() =>
      verifySignWellWakeup(JSON.stringify(event), "wrong", time * 1000),
    ).toThrow("INVALID_WEBHOOK");
    expect(() =>
      verifySignWellWakeup(
        JSON.stringify(event),
        "hook-id",
        (time + 8 * 86400) * 1000,
      ),
    ).toThrow("INVALID_WEBHOOK");
  });
  it("does not expose provider response bodies and rejects non-PDF evidence", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret-provider-body", { status: 422 }));
    await expect(
      new SignWellClient("private-key", transport).get(providerId),
    ).rejects.toThrow(/^SIGNWELL_HTTP_422$/);
    transport.mockResolvedValue(new Response("not a pdf"));
    await expect(
      new SignWellClient("private-key", transport).completedPdf(providerId),
    ).rejects.toThrow("INVALID_PDF");
  });
});

it("blocks sending when any required partner detail is missing or assigned to Fil One", async () => {
  const { mndaRecipientFields } = await import("../../../contracts/src/mnda");
  const record = {
    ...fixtureRecord,
    input: { ...fixtureRecord.input, detailsMode: "recipient" as const },
  };
  const document = doc();
  const fields = document.fields[0];
  if (!fields) throw new Error("Expected fields");
  fields.push(
    ...mndaRecipientFields.map(({ id }) => ({
      api_id: id,
      recipient_id: "counterparty",
      type: "text",
      required: true,
    })),
  );
  expect(() => assertSignWellSigningFields(document, record)).not.toThrow();
  const field = fields.at(-1);
  if (!field) throw new Error("Expected detail field");
  field.required = false;
  expect(() => assertSignWellSigningFields(document, record)).toThrow(
    "SIGNING_FIELDS",
  );
  field.required = true;
  field.recipient_id = "fil-one";
  expect(() => assertSignWellSigningFields(document, record)).toThrow(
    "SIGNING_FIELDS",
  );
});

it("requires exactly the missing mixed-mode fields before sending", async () => {
  const { mndaSigningFields } = await import("../../../contracts/src/mnda");
  const record = {
    ...fixtureRecord,
    input: {
      ...fixtureRecord.input,
      detailsMode: "mixed" as const,
      entityDescription: "",
      locality: "",
    },
  };
  const document = doc();
  const fields = document.fields[0];
  if (!fields) throw new Error("Expected signing fields");
  fields.push(
    ...mndaSigningFields(record.input).map(({ id }) => ({
      api_id: id,
      recipient_id: "counterparty",
      type: "text",
      required: true,
    })),
  );
  expect(() => assertSignWellSigningFields(document, record)).not.toThrow();
  fields.pop();
  expect(() => assertSignWellSigningFields(document, record)).toThrow(
    "SIGNING_FIELDS",
  );
});

describe("partner-facing details and after-send corrections", () => {
  const created = async (record: typeof fixtureRecord) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(doc())));
    await new SignWellClient("private-key", transport).createDraft(
      record,
      Buffer.from("%PDF-test"),
    );
    const raw = transport.mock.calls[0]?.[1]?.body;
    if (typeof raw !== "string") throw new Error("Expected JSON body");
    return JSON.parse(raw) as {
      name: string;
      subject: string;
      copied_contacts: { name: string; email: string }[];
    };
  };
  it("names the document for the partner and never shows an internal reference", async () => {
    expect((await created(fixtureRecord)).name).toBe(
      "Mutual NDA: Fil One and Example Corporation",
    );
    const reference = await created({
      ...fixtureRecord,
      input: {
        ...fixtureRecord.input,
        detailsMode: "recipient",
        company: "Acme, warm intro via Bob",
      },
    });
    expect(reference.name).toBe("Mutual NDA: Fil One");
    expect(JSON.stringify(reference)).not.toContain("warm intro");
    expect(JSON.stringify(reference)).not.toContain("Commerce");
    expect(reference.subject).not.toMatch(/—/);
  });
  it("copies the sender on the completed agreement unless the sender already signs", async () => {
    expect((await created(fixtureRecord)).copied_contacts).toEqual([
      { name: fixtureRecord.ownerName, email: "seller@example.com" },
    ]);
    expect(
      (
        await created({
          ...fixtureRecord,
          ownerEmail: fixtureRecord.countersigner.email,
        })
      ).copied_contacts,
    ).toEqual([]);
    expect(
      (await created({ ...fixtureRecord, ownerEmail: null })).copied_contacts,
    ).toEqual([]);
  });
  it("replaces only the partner recipient through SignWell's update endpoint", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(doc())));
    await new SignWellClient("private-key", transport).updateRecipient(
      providerId,
      { id: "counterparty", name: "Alex", email: "right@example.com" },
    );
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://www.signwell.com/api/v1/documents/${providerId}/recipients`,
    );
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({
      recipients: [
        { id: "counterparty", name: "Alex", email: "right@example.com" },
      ],
    });
  });
  it("accepts the corrected or original partner email and explains bounces", () => {
    const corrected = {
      ...fixtureRecord,
      correctedSignerEmail: "right@example.com",
    };
    const moved = doc();
    if (moved.recipients[0]) moved.recipients[0].email = "right@example.com";
    expect(signWellState(moved, corrected)).toBe("ready");
    expect(signWellState(doc(), corrected)).toBe("ready");
    const stranger = doc();
    if (stranger.recipients[0])
      stranger.recipients[0].email = "stranger@example.com";
    expect(() => signWellState(stranger, corrected)).toThrow("SIGNERS");
    const bounced = doc();
    bounced.status = "Sent";
    if (bounced.recipients[0]) bounced.recipients[0].bounced = true;
    expect(signWellState(bounced, fixtureRecord)).toBe("attention");
    expect(signWellAttentionReason(bounced)).toBe("recipient_bounced");
    expect(signWellAttentionReason({ ...doc(), status: "Error" })).toBe(
      "provider_stopped",
    );
  });
});

describe("after-send safety checks", () => {
  it("accepts the original, confirmed and pending partner emails until a refresh settles them", () => {
    const pending = {
      ...fixtureRecord,
      correctedSignerEmail: "second@example.com",
      pendingSignerEmail: "third@example.com",
    };
    for (const email of [
      fixtureRecord.input.signerEmail,
      "second@example.com",
      "third@example.com",
    ]) {
      const document = doc();
      const partner = document.recipients[0];
      if (partner) partner.email = email;
      expect(signWellState(document, pending)).toBe("ready");
    }
  });
  it("verifies a reported copy of the sender", () => {
    expect(
      assertSignWellCopiedContacts(
        { ...doc(), copied_contacts: [{ email: "Seller@Example.com" }] },
        fixtureRecord,
      ),
    ).toBe("verified");
    expect(
      assertSignWellCopiedContacts(
        { ...doc(), copied_contacts: [] },
        { ...fixtureRecord, ownerEmail: null },
      ),
    ).toBe("verified");
  });
  it("lets sending continue when SignWell does not report copied contacts", () => {
    expect(assertSignWellCopiedContacts(doc(), fixtureRecord)).toBe(
      "unreported",
    );
    expect(
      assertSignWellCopiedContacts(
        { ...doc(), copied_contacts: null },
        fixtureRecord,
      ),
    ).toBe("unreported");
  });
  it("blocks sending when the reported copies leave out the sender", () => {
    for (const copied_contacts of [[], [{ email: "someone@example.com" }]])
      expect(() =>
        assertSignWellCopiedContacts(
          { ...doc(), copied_contacts },
          fixtureRecord,
        ),
      ).toThrow("COPIED_CONTACTS");
  });
  it("treats only a 4xx answer as a definite refusal", () => {
    expect(signWellRefused(new Error("SIGNWELL_HTTP_422"))).toBe(true);
    expect(signWellRefused(new Error("SIGNWELL_HTTP_408"))).toBe(false);
    expect(signWellRefused(new Error("SIGNWELL_HTTP_502"))).toBe(false);
    expect(
      signWellRefused(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ),
    ).toBe(false);
  });
});
