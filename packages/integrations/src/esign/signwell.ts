import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  mndaSignerEmail,
  mndaSigning,
  signatureFields,
  type MndaAttentionReason,
  type MndaRecord,
  type MndaState,
  type SigningDocumentType,
  type SigningField,
  type SigningState,
} from "@clockwork/contracts";

/**
 * One schema for every document Commerce sends through SignWell. Only the
 * metadata key binding a document to its request differs by type
 * (`commerce_mnda_id`, `commerce_contract_id`).
 */
export function signWellDocumentSchema<K extends string>(bindingKey: K) {
  return z.object({
    id: z.uuid(),
    status: z.string(),
    test_mode: z.boolean(),
    metadata: z
      .object({ template_sha256: z.string() })
      .extend({ [bindingKey]: z.uuid() } as Record<K, z.ZodUUID>),
    recipients: z.array(
      z.object({
        id: z.string(),
        email: z.email(),
        name: z.string(),
        status: z.string().nullable().optional(),
        bounced: z.boolean().nullable().optional(),
        signing_order: z.number().int().nullable().optional(),
      }),
    ),
    fields: z.array(
      z.array(
        z.object({
          recipient_id: z.string(),
          type: z.string(),
          required: z.boolean(),
          api_id: z.string().nullable().optional(),
        }),
      ),
    ),
    apply_signing_order: z.boolean(),
    copied_contacts: z
      .array(z.object({ email: z.string() }))
      .nullable()
      .optional(),
  });
}
export type SignWellSigningDocument<K extends string = string> = z.infer<
  ReturnType<typeof signWellDocumentSchema<K>>
>;
export type SignWellDocument = SignWellSigningDocument<"commerce_mnda_id">;
export interface MndaSigningProvider {
  createDraft(record: MndaRecord, pdf: Uint8Array): Promise<SignWellDocument>;
  get(id: string): Promise<SignWellDocument>;
  send(id: string, testMode: boolean): Promise<void>;
  remind(id: string): Promise<void>;
  /** Deletes the document in SignWell, which also stops signing. */
  cancel(id: string): Promise<void>;
  /** Replaces a recipient who has not started signing; SignWell re-sends. */
  updateRecipient(
    id: string,
    recipient: { id: string; name: string; email: string },
  ): Promise<SignWellDocument>;
  completedPdf(id: string): Promise<Uint8Array>;
}
/** What a new draft is bound to and who signs it, in signing order. */
export interface SignWellDraft {
  id: string;
  templateHash: string;
  testMode: boolean;
  recipients: readonly { id: string; name: string; email: string }[];
  copiedContacts: readonly { name: string; email: string }[];
}

/**
 * SignWell's document API for one document type: one transport, timeout,
 * response cap and document schema, whichever type it carries.
 */
export abstract class SignWellSigningClient<K extends string> {
  protected abstract readonly bindingKey: K;
  constructor(
    private readonly apiKey: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error("SIGNWELL_NOT_CONFIGURED");
  }
  protected async request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.transport(
        `https://www.signwell.com/api/v1/${path}`,
        {
          method,
          redirect: "error",
          signal: controller.signal,
          headers: {
            "X-Api-Key": this.apiKey,
            accept: "application/json, application/pdf",
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      if (!response.ok) throw new Error(`SIGNWELL_HTTP_${response.status}`);
      if (!response.body) return new Uint8Array();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 12_000_000) {
          await reader.cancel();
          throw new Error("SIGNWELL_RESPONSE_TOO_LARGE");
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer);
    }
  }
  protected async document(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<SignWellSigningDocument<K>> {
    return signWellDocumentSchema(this.bindingKey).parse(
      JSON.parse(
        Buffer.from(await this.request(path, method, body)).toString("utf8"),
      ),
    );
  }
  /** An unsent draft. Text tags place the fields; sending is a separate call. */
  protected createSigningDraft<R>(
    type: SigningDocumentType<R>,
    record: R,
    draft: SignWellDraft,
    pdf: Uint8Array,
  ) {
    return this.document("documents", "POST", {
      draft: true,
      test_mode: draft.testMode,
      name: type.documentName(record),
      files: [
        {
          name: type.fileName(record),
          file_base64: Buffer.from(pdf).toString("base64"),
        },
      ],
      recipients: draft.recipients,
      ...(type.copySender ? { copied_contacts: draft.copiedContacts } : {}),
      apply_signing_order: true,
      text_tags: true,
      reminders: true,
      expires_in: 30,
      embedded_signing: false,
      allow_reassign: false,
      subject: type.subject(record),
      message: type.message(record),
      metadata: {
        [type.bindingKey]: draft.id,
        template_sha256: draft.templateHash,
      },
    });
  }
  get(id: string) {
    return this.document(`documents/${z.uuid().parse(id)}`);
  }
  /** SignWell's update-and-send request has no copied-contacts field; the
   * copy is set on the draft and checked before sending. */
  async send(id: string, testMode: boolean) {
    await this.request(`documents/${z.uuid().parse(id)}/send`, "POST", {
      test_mode: testMode,
      apply_signing_order: true,
      reminders: true,
      allow_reassign: false,
    });
  }
  async remind(id: string) {
    await this.request(`documents/${z.uuid().parse(id)}/remind`, "POST", {});
  }
  async cancel(id: string) {
    await this.request(`documents/${z.uuid().parse(id)}`, "DELETE");
  }
  updateRecipient(
    id: string,
    recipient: { id: string; name: string; email: string },
  ) {
    return this.document(
      `documents/${z.uuid().parse(id)}/recipients`,
      "PATCH",
      { recipients: [recipient] },
    );
  }
  async completedPdf(id: string) {
    const bytes = await this.request(
      `documents/${z.uuid().parse(id)}/completed_pdf?url_only=false&audit_page=true&file_format=pdf`,
    );
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
      throw new Error("SIGNWELL_INVALID_PDF");
    return bytes;
  }
}
export class SignWellClient
  extends SignWellSigningClient<"commerce_mnda_id">
  implements MndaSigningProvider
{
  protected readonly bindingKey = "commerce_mnda_id";
  createDraft(r: MndaRecord, pdf: Uint8Array) {
    return this.createSigningDraft(
      mndaSigning,
      r,
      {
        id: r.id,
        templateHash: r.templateHash,
        testMode: r.testMode,
        recipients: [
          {
            id: "counterparty",
            name: r.input.signerName,
            email: mndaSignerEmail(r),
          },
          {
            id: "fil-one",
            name: r.countersigner.name,
            email: r.countersigner.email,
          },
        ],
        copiedContacts: signWellCopiedContacts(r),
      },
      pdf,
    );
  }
}
/** The sender receives the completed agreement by email. Recipients already
 * do, so a sender who also signs is not copied twice. */
export function signWellCopiedContacts(r: MndaRecord) {
  const recipients = [mndaSignerEmail(r), r.countersigner.email];
  return r.ownerEmail && !recipients.includes(r.ownerEmail)
    ? [{ name: r.ownerName, email: r.ownerEmail }]
    : [];
}
/**
 * Before delivery: when SignWell reports the draft's copied contacts, they
 * must include every expected address, or sending stops. Whether SignWell
 * echoes the field on a fetched draft is not yet confirmed, so a document
 * without it returns `"unreported"` and sending continues; the caller records
 * that.
 */
export function checkSignWellCopiedContacts(
  doc: SignWellSigningDocument,
  expected: readonly string[],
): "verified" | "unreported" {
  if (doc.copied_contacts == null) return "unreported";
  const actual = new Set(doc.copied_contacts.map((c) => c.email.toLowerCase()));
  if (!expected.every((email) => actual.has(email)))
    throw new Error("SIGNWELL_COPIED_CONTACTS_MISMATCH");
  return "verified";
}
export function assertSignWellCopiedContacts(
  doc: SignWellDocument,
  record: MndaRecord,
): "verified" | "unreported" {
  return checkSignWellCopiedContacts(
    doc,
    signWellCopiedContacts(record).map((c) => c.email),
  );
}
/** Whether a failed call certainly changed nothing at SignWell: a 4xx refusal.
 * Timeouts, 5xx and unreadable responses may have been applied. */
export function signWellRefused(error: unknown): boolean {
  const status = /^SIGNWELL_HTTP_(\d{3})$/.exec(
    error instanceof Error ? error.message : "",
  )?.[1];
  return Boolean(status?.startsWith("4") && status !== "408");
}
/** Partner-facing; see `mndaSigning`. */
export function signWellDocumentName(r: MndaRecord): string {
  return mndaSigning.documentName(r);
}
/** The webhook MAC authenticates only type/time, NOT its document payload.
 * Treat callbacks as wakeups and GET the bound document before applying state. */
export function verifySignWellWakeup(
  raw: string,
  webhookId: string,
  now = Date.now(),
): string {
  if (!webhookId) throw new Error("SIGNWELL_WEBHOOK_NOT_CONFIGURED");
  const event = z
    .object({
      event: z.object({
        type: z.string().max(80),
        time: z.number().int(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      data: z.object({ object: z.object({ id: z.uuid() }) }),
    })
    .parse(JSON.parse(raw));
  const expected = createHmac("sha256", webhookId)
    .update(`${event.event.type}@${event.event.time}`)
    .digest();
  if (
    !timingSafeEqual(expected, Buffer.from(event.event.hash, "hex")) ||
    event.event.time * 1000 > now + 300_000 ||
    event.event.time * 1000 < now - 7 * 86400_000
  )
    throw new Error("SIGNWELL_INVALID_WEBHOOK");
  return event.data.object.id;
}
/** What a SignWell copy must match: its request, mode and signers. */
export interface SignWellBinding {
  bindingKey: string;
  id: string;
  templateHash: string;
  testMode: boolean;
  providerId: string | null;
  /** In signing order. A signer whose email is being corrected is matched
   * by any address the correction may show until a refresh settles it. */
  signers: readonly { id: string; emails: readonly string[] }[];
}
/** The authoritative state of a bound document, after checking that it is
 * the document this request created, for the same signers and mode. */
export function signWellSigningState(
  doc: SignWellSigningDocument,
  binding: SignWellBinding,
): SigningState {
  if (
    doc.metadata[binding.bindingKey] !== binding.id ||
    doc.metadata.template_sha256 !== binding.templateHash ||
    doc.test_mode !== binding.testMode ||
    (binding.providerId && doc.id !== binding.providerId)
  )
    throw new Error("SIGNWELL_BINDING_MISMATCH");
  const email = (id: string) =>
    doc.recipients.find((r) => r.id === id)?.email.toLowerCase();
  if (
    doc.recipients.length !== binding.signers.length ||
    !binding.signers.every(({ id, emails }) => {
      const shown = email(id);
      return shown && emails.some((e) => e.toLowerCase() === shown);
    })
  )
    throw new Error("SIGNWELL_SIGNERS_MISMATCH");
  const status = doc.status.toLowerCase();
  if (status === "completed") return "completed";
  if (status === "declined" || status === "expired" || status === "canceled")
    return status;
  if (doc.recipients.some((r) => r.bounced)) return "attention";
  if (status === "created") return "preparing";
  if (status === "draft") return "ready";
  if (status === "sending") return "sending";
  if (!["sent", "pending", "viewed"].includes(status)) return "attention";
  const first = doc.recipients.find((r) => r.id === binding.signers[0]?.id);
  if (["signed", "completed"].includes(first?.status?.toLowerCase() ?? ""))
    return "awaiting_countersignature";
  if (status === "viewed" || status === "pending") return "viewed";
  return "sent";
}
export function signWellState(
  doc: SignWellDocument,
  record: MndaRecord,
): MndaState {
  // A partner email change is recorded before SignWell confirms it, so the
  // original, the last confirmed correction and a pending one all identify
  // the partner until the next successful refresh settles it.
  const partner = [
    record.input.signerEmail,
    record.correctedSignerEmail,
    record.pendingSignerEmail,
  ].filter((email): email is string => Boolean(email));
  return signWellSigningState(doc, {
    bindingKey: mndaSigning.bindingKey,
    id: record.id,
    templateHash: record.templateHash,
    testMode: record.testMode,
    providerId: record.providerId,
    signers: [
      { id: "counterparty", emails: partner },
      { id: "fil-one", emails: [record.countersigner.email] },
    ],
  });
}

/** Why a document in `attention` needs a person. */
export function signWellAttentionReason(
  doc: SignWellSigningDocument,
): MndaAttentionReason {
  return doc.status.toLowerCase() === "bounced" ||
    doc.recipients.some((r) => r.bounced)
    ? "recipient_bounced"
    : "provider_stopped";
}

/** Signers in order, each with exactly the required fields expected of
 * them and no others. */
export function assertSignWellFields(
  doc: SignWellSigningDocument,
  expected: readonly { id: string; fields: readonly SigningField[] }[],
) {
  if (
    !doc.apply_signing_order ||
    expected.some((slot, index) => doc.recipients[index]?.id !== slot.id)
  )
    throw new Error("SIGNWELL_SIGNING_ORDER_MISMATCH");
  const fields = doc.fields.flat();
  if (
    fields.length !==
      expected.reduce((total, slot) => total + slot.fields.length, 0) ||
    !expected.every((slot) =>
      slot.fields.every(
        (want) =>
          fields.filter(
            (f) =>
              f.recipient_id === slot.id &&
              f.type === want.type &&
              f.required &&
              (want.apiId === undefined || f.api_id === want.apiId),
          ).length === 1,
      ),
    )
  )
    throw new Error("SIGNWELL_SIGNING_FIELDS_MISMATCH");
}
/** Without a record, only the signatures and signing dates are checked. */
export function assertSignWellSigningFields(
  doc: SignWellDocument,
  record?: MndaRecord,
) {
  assertSignWellFields(
    doc,
    mndaSigning.slots.map((slot) => ({
      id: slot.id,
      fields: record ? slot.fields(record) : signatureFields,
    })),
  );
}
