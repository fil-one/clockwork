import { describe, expect, it, vi } from "vitest";
import { fixtureSigningRecord as record } from "../../../contracts/src/contract-fixture";
import {
  assertContractSigningFields,
  contractSignWellState,
  SignWellContractClient,
  type SignWellContractDocument,
} from "./signwell-contracts";

const providerId = "019a44ac-0000-7000-8000-0000000000d1";
const doc = (): SignWellContractDocument => ({
  id: providerId,
  status: "Draft",
  test_mode: true,
  metadata: {
    commerce_contract_id: record.contractId,
    template_sha256: record.templateHash,
  },
  recipients: [
    { id: "counterparty", email: "Alex@Example.com", name: "Alex" },
    { id: "fil-one", email: record.countersigner.email, name: "James" },
  ],
  apply_signing_order: true,
  fields: [
    ["counterparty", "fil-one"].flatMap((recipient_id) =>
      ["signature", "autofill_date_signed"].map((type) => ({
        recipient_id,
        type,
        required: true,
      })),
    ),
  ],
});

describe("SignWell template contracts", () => {
  it("creates an unsent draft named for the signer, never for an internal reference", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(doc())));
    await new SignWellContractClient(
      "private-key",
      transport,
    ).createContractDraft(record, Buffer.from("%PDF-test"));
    const sent = transport.mock.calls[0]?.[1]?.body;
    if (typeof sent !== "string") throw new Error("Expected JSON request body");
    const body = JSON.parse(sent) as {
      name: string;
      subject: string;
      recipients: { id: string; email: string }[];
      metadata: Record<string, string>;
    };
    expect(body).toMatchObject({
      draft: true,
      test_mode: true,
      apply_signing_order: true,
      text_tags: true,
      allow_reassign: false,
      name: record.documentName,
      subject: record.documentName,
      metadata: {
        commerce_contract_id: record.contractId,
        template_sha256: record.templateHash,
      },
    });
    expect(body.recipients.map((r) => [r.id, r.email])).toEqual([
      ["counterparty", "alex@example.com"],
      ["fil-one", "james@example.com"],
    ]);
    expect(JSON.stringify(body)).not.toContain(
      record.contractId.slice(0, 8) + " ",
    );
  });

  it("rejects a document bound to another record, mode or signer", () => {
    expect(contractSignWellState(doc(), record)).toBe("ready");
    expect(() =>
      contractSignWellState(
        {
          ...doc(),
          metadata: { ...doc().metadata, commerce_contract_id: providerId },
        },
        record,
      ),
    ).toThrow("BINDING");
    expect(() =>
      contractSignWellState({ ...doc(), test_mode: false }, record),
    ).toThrow("BINDING");
    expect(() =>
      contractSignWellState(doc(), {
        ...record,
        providerId: record.contractId,
      }),
    ).toThrow("BINDING");
    expect(() =>
      contractSignWellState(
        { ...doc(), recipients: doc().recipients.slice(0, 1) },
        record,
      ),
    ).toThrow("SIGNERS");
  });

  it("maps provider progress to signing states", () => {
    const at = (
      status: string,
      patch: Partial<SignWellContractDocument> = {},
    ) => contractSignWellState({ ...doc(), status, ...patch }, record);
    expect(at("Created")).toBe("preparing");
    expect(at("Sent")).toBe("sent");
    expect(at("Viewed")).toBe("viewed");
    expect(at("Completed")).toBe("completed");
    expect(at("Declined")).toBe("declined");
    expect(at("Something new")).toBe("attention");
    const [counterparty, filOne] = doc().recipients;
    if (!counterparty || !filOne) throw new Error("Expected two recipients");
    expect(
      at("Sent", { recipients: [{ ...counterparty, bounced: true }, filOne] }),
    ).toBe("attention");
    expect(
      at("Sent", {
        recipients: [{ ...counterparty, status: "signed" }, filOne],
      }),
    ).toBe("awaiting_countersignature");
  });

  it("requires one signature and one signing date per signer, in order", () => {
    expect(() => assertContractSigningFields(doc())).not.toThrow();
    expect(() =>
      assertContractSigningFields({
        ...doc(),
        fields: [(doc().fields[0] ?? []).slice(1)],
      }),
    ).toThrow("SIGNING_FIELDS");
    expect(() =>
      assertContractSigningFields({
        ...doc(),
        recipients: [...doc().recipients].reverse(),
      }),
    ).toThrow("SIGNING_ORDER");
  });

  it("keeps provider response bodies out of errors", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret-provider-body", { status: 500 }));
    await expect(
      new SignWellContractClient("private-key", transport).getContract(
        providerId,
      ),
    ).rejects.toThrow(/^SIGNWELL_HTTP_500$/);
  });
});
