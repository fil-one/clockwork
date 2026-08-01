import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { ids, IdempotencyKeySchema } from "@clockwork/contracts";

import type { ProviderJsonTransport } from "../provider-transport";
import {
  HttpLifecycleScreeningAdapter,
  HttpLifecycleSignatureAdapter,
} from "./lifecycle-http-providers";

class RecordingTransport implements ProviderJsonTransport {
  public readonly requests: {
    operation: string;
    idempotencyKey?: string;
  }[] = [];

  private readonly responses: unknown[];

  public constructor(responses: readonly unknown[]) {
    this.responses = [...responses];
  }

  public request<T>(input: {
    operation: string;
    path: string;
    body: Readonly<Record<string, unknown>>;
    response: ZodType<T>;
    idempotencyKey?: string;
  }): Promise<T> {
    this.requests.push({
      operation: input.operation,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    return Promise.resolve(input.response.parse(this.responses.shift()));
  }
}

describe("lifecycle HTTP provider contracts", () => {
  it("requires and forwards the durable screening idempotency key", async () => {
    const transport = new RecordingTransport([
      { decision: "clear", reference: "screening-1" },
    ]);
    const adapter = new HttpLifecycleScreeningAdapter(transport);
    const idempotencyKey = IdempotencyKeySchema.parse(
      "lifecycle-effect:screening:0001",
    );
    await expect(
      adapter.screen({
        accountId: ids.account.parse("10000000-0000-4000-8000-000000000001"),
        legalName: "Persisted Customer",
        country: "US",
        reason: "registration",
        idempotencyKey,
      }),
    ).resolves.toEqual({
      ok: true,
      value: { decision: "clear", reference: "screening-1" },
    });
    expect(transport.requests).toEqual([
      { operation: "screening.screen", idempotencyKey },
    ]);
  });

  it("allows only configured HTTPS signing origins and decodes completed evidence", async () => {
    const transport = new RecordingTransport([
      {
        envelopeId: "envelope-1",
        signingUrl: "https://signing.example.test/session/1",
      },
      {
        bytesBase64: Buffer.from("signed").toString("base64"),
        certificateBase64: Buffer.from("certificate").toString("base64"),
      },
    ]);
    const adapter = new HttpLifecycleSignatureAdapter(transport, [
      "https://signing.example.test",
    ]);
    await expect(
      adapter.createEnvelope({
        accountId: ids.account.parse("10000000-0000-4000-8000-000000000001"),
        documentId: ids.document.parse("40000000-0000-4000-8000-000000000001"),
        signerEmail: "signer@example.test",
        idempotencyKey: IdempotencyKeySchema.parse(
          "lifecycle-effect:signature:0001",
        ),
      }),
    ).resolves.toMatchObject({ ok: true, value: { envelopeId: "envelope-1" } });
    const completed = await adapter.downloadCompletedDocument("envelope-1");
    expect(completed).toMatchObject({ ok: true });
    if (completed.ok) {
      expect(new TextDecoder().decode(completed.value.bytes)).toBe("signed");
      expect(new TextDecoder().decode(completed.value.certificate)).toBe(
        "certificate",
      );
    }
  });

  it("fails closed on an untrusted provider redirect", async () => {
    const adapter = new HttpLifecycleSignatureAdapter(
      new RecordingTransport([
        {
          envelopeId: "envelope-1",
          signingUrl: "https://attacker.example/session/1",
        },
      ]),
      ["https://signing.example.test"],
    );
    await expect(
      adapter.createEnvelope({
        accountId: ids.account.parse("10000000-0000-4000-8000-000000000001"),
        documentId: ids.document.parse("40000000-0000-4000-8000-000000000001"),
        signerEmail: "signer@example.test",
        idempotencyKey: IdempotencyKeySchema.parse(
          "lifecycle-effect:signature:0002",
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "permanent",
      code: "SIGNATURE_REDIRECT_UNTRUSTED",
    });
  });
});
