import { Buffer } from "node:buffer";

import type {
  ProviderResult,
  ScreeningPort,
  SignaturePort,
} from "@clockwork/contracts";
import { z } from "zod";

import {
  providerTransportFailure,
  type ProviderJsonTransport,
} from "../provider-transport";
import type {
  IdempotentLifecycleScreeningPort,
  LifecycleEffectProviderPorts,
} from "./lifecycle-effect-executor";

const ScreeningResponseSchema = z.object({
  decision: z.enum(["clear", "review", "blocked"]),
  reference: z.string().trim().min(1).max(500),
});

const SignatureEnvelopeResponseSchema = z.object({
  envelopeId: z.string().trim().min(1).max(500),
  signingUrl: z.url(),
});

const CompletedSignatureResponseSchema = z.object({
  bytesBase64: z.string().min(1).max(10_000_000),
  certificateBase64: z.string().min(1).max(2_000_000),
});

/** Authenticated provider-neutral screening contract with mandatory replay key. */
export class HttpLifecycleScreeningAdapter implements IdempotentLifecycleScreeningPort {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public async screen(
    input: Parameters<ScreeningPort["screen"]>[0] & {
      idempotencyKey: Parameters<
        LifecycleEffectProviderPorts["screening"]["screen"]
      >[0]["idempotencyKey"];
    },
  ): Promise<Awaited<ReturnType<ScreeningPort["screen"]>>> {
    try {
      const value = await this.transport.request({
        operation: "screening.screen",
        path: "/v1/screening/decisions",
        body: input,
        response: ScreeningResponseSchema,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true, value };
    } catch (error) {
      return providerTransportFailure(error, "SCREENING_PROVIDER_ERROR");
    }
  }
}

/** Provider-neutral signature contract; signing redirects are origin allow-listed. */
export class HttpLifecycleSignatureAdapter implements SignaturePort {
  private readonly signingOrigins: ReadonlySet<string>;

  public constructor(
    private readonly transport: ProviderJsonTransport,
    signingOrigins: readonly string[],
  ) {
    this.signingOrigins = new Set(
      signingOrigins.map((value) => trustedOrigin(value)),
    );
    if (this.signingOrigins.size === 0)
      throw new Error("SIGNATURE_SIGNING_ORIGIN_REQUIRED");
  }

  public async createEnvelope(
    input: Parameters<SignaturePort["createEnvelope"]>[0],
  ): Promise<Awaited<ReturnType<SignaturePort["createEnvelope"]>>> {
    try {
      const value = await this.transport.request({
        operation: "signature.create_envelope",
        path: "/v1/signatures/envelopes",
        body: input,
        response: SignatureEnvelopeResponseSchema,
        idempotencyKey: input.idempotencyKey,
      });
      const signingUrl = new URL(value.signingUrl);
      if (
        signingUrl.protocol !== "https:" ||
        signingUrl.username ||
        signingUrl.password ||
        !this.signingOrigins.has(signingUrl.origin)
      )
        return permanent(
          "SIGNATURE_REDIRECT_UNTRUSTED",
          "Signature provider returned an untrusted signing origin",
        );
      return {
        ok: true,
        value: { ...value, signingUrl: signingUrl.toString() },
      };
    } catch (error) {
      return providerTransportFailure(error, "SIGNATURE_PROVIDER_ERROR");
    }
  }

  public async downloadCompletedDocument(
    envelopeId: string,
  ): Promise<Awaited<ReturnType<SignaturePort["downloadCompletedDocument"]>>> {
    try {
      const value = await this.transport.request({
        operation: "signature.download_completed",
        path: "/v1/signatures/envelopes/completed-document",
        body: { envelopeId },
        response: CompletedSignatureResponseSchema,
      });
      return {
        ok: true,
        value: {
          bytes: new Uint8Array(Buffer.from(value.bytesBase64, "base64")),
          certificate: new Uint8Array(
            Buffer.from(value.certificateBase64, "base64"),
          ),
        },
      };
    } catch (error) {
      return providerTransportFailure(error, "SIGNATURE_PROVIDER_ERROR");
    }
  }
}

function trustedOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("SIGNATURE_SIGNING_ORIGIN_INVALID");
  return url.origin;
}

function permanent(code: string, message: string): ProviderResult<never> {
  return { ok: false, kind: "permanent", code, message };
}
