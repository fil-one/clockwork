import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  mndaSignerEmail,
  mndaSigningFields,
  type MndaAttentionReason,
  type MndaRecord,
  type MndaState,
} from "@clockwork/contracts";

const documentSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  test_mode: z.boolean(),
  metadata: z.object({
    commerce_mnda_id: z.uuid(),
    template_sha256: z.string(),
  }),
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
});
export type SignWellDocument = z.infer<typeof documentSchema>;
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
export class SignWellClient implements MndaSigningProvider {
  constructor(
    private readonly apiKey: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error("SIGNWELL_NOT_CONFIGURED");
  }
  private async request(
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
  private async document(path: string, method = "GET", body?: unknown) {
    return documentSchema.parse(
      JSON.parse(
        Buffer.from(await this.request(path, method, body)).toString("utf8"),
      ),
    );
  }
  createDraft(r: MndaRecord, pdf: Uint8Array) {
    const recipients = [
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
    ];
    // The sender gets the completed agreement by email. Recipients already
    // receive it, so a sender who also countersigns is not copied twice.
    const copied =
      r.ownerEmail &&
      !recipients.some((recipient) => recipient.email === r.ownerEmail)
        ? [{ name: r.ownerName, email: r.ownerEmail }]
        : [];
    return this.document("documents", "POST", {
      draft: true,
      test_mode: r.testMode,
      name: signWellDocumentName(r),
      files: [
        {
          name: "Fil-One-MNDA.pdf",
          file_base64: Buffer.from(pdf).toString("base64"),
        },
      ],
      recipients,
      copied_contacts: copied,
      apply_signing_order: true,
      text_tags: true,
      reminders: true,
      expires_in: 30,
      embedded_signing: false,
      allow_reassign: false,
      subject: "Fil One: Mutual Non-Disclosure Agreement",
      message:
        "Please review and sign the mutual non-disclosure agreement. Fil One will countersign and you will receive the completed agreement.",
      metadata: { commerce_mnda_id: r.id, template_sha256: r.templateHash },
    });
  }
  get(id: string) {
    return this.document(`documents/${z.uuid().parse(id)}`);
  }
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
/** Partner-facing. In the partner-completes mode the company field is only an
 * internal reference, so it is never shown to the partner. */
export function signWellDocumentName(r: MndaRecord): string {
  return r.input.detailsMode === "recipient"
    ? "Mutual NDA: Fil One"
    : `Mutual NDA: Fil One and ${r.input.company}`;
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
export function signWellState(
  doc: SignWellDocument,
  record: MndaRecord,
): MndaState {
  if (
    doc.metadata.commerce_mnda_id !== record.id ||
    doc.metadata.template_sha256 !== record.templateHash ||
    doc.test_mode !== record.testMode ||
    (record.providerId && doc.id !== record.providerId)
  )
    throw new Error("SIGNWELL_BINDING_MISMATCH");
  // A corrected partner email is written before SignWell confirms it, so
  // either the original or the corrected address identifies the partner.
  const partnerEmail = doc.recipients
    .find((r) => r.id === "counterparty")
    ?.email.toLowerCase();
  if (
    doc.recipients.length !== 2 ||
    !partnerEmail ||
    ![record.input.signerEmail, mndaSignerEmail(record)].includes(
      partnerEmail,
    ) ||
    doc.recipients.find((r) => r.id === "fil-one")?.email.toLowerCase() !==
      record.countersigner.email
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
  const recipient = doc.recipients.find((r) => r.id === "counterparty");
  if (["signed", "completed"].includes(recipient?.status?.toLowerCase() ?? ""))
    return "awaiting_countersignature";
  if (status === "viewed" || status === "pending") return "viewed";
  return "sent";
}

/** Why a document in `attention` needs a person. */
export function signWellAttentionReason(
  doc: SignWellDocument,
): MndaAttentionReason {
  return doc.status.toLowerCase() === "bounced" ||
    doc.recipients.some((r) => r.bounced)
    ? "recipient_bounced"
    : "provider_stopped";
}

export function assertSignWellSigningFields(
  doc: SignWellDocument,
  record?: MndaRecord,
) {
  if (
    !doc.apply_signing_order ||
    doc.recipients[0]?.id !== "counterparty" ||
    doc.recipients[1]?.id !== "fil-one"
  )
    throw new Error("SIGNWELL_SIGNING_ORDER_MISMATCH");
  const fields = doc.fields.flat();
  const detailFields = record ? mndaSigningFields(record.input) : [];
  if (
    fields.length !== 4 + detailFields.length ||
    !detailFields.every(
      ({ id }) =>
        fields.filter(
          (f) =>
            f.api_id === id &&
            f.recipient_id === "counterparty" &&
            f.type === "text" &&
            f.required,
        ).length === 1,
    ) ||
    !["counterparty", "fil-one"].every((id) =>
      ["signature", "autofill_date_signed"].every(
        (type) =>
          fields.filter(
            (f) => f.recipient_id === id && f.type === type && f.required,
          ).length === 1,
      ),
    )
  )
    throw new Error("SIGNWELL_SIGNING_FIELDS_MISMATCH");
}
