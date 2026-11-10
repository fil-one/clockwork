import type {
  RecipientSigningView,
  SigningJourneyKind,
  SigningJourneySnapshot,
  SigningRecipient,
  SigningState,
} from "@clockwork/contracts";
import type { SigningJourneyStore } from "@clockwork/db";
import {
  recipientAccessToken,
  recipientLinkLifetimeSeconds,
  signWellRecipientUrl,
  signWellSigningState,
  type SignWellSigningDocument,
  type StaffEmailPort,
} from "@clockwork/integrations";
import { signingEmail } from "./email";

export interface JourneySource {
  version: number;
  kind: SigningJourneyKind;
  id: string;
  providerId: string | null;
  title: string;
  templateHash: string;
  testMode: boolean;
  state: SigningState;
  pendingCorrection: boolean;
  signers: readonly { id: string; name: string; email: string }[];
  copies: readonly { name: string; email: string }[];
  pdf(): Promise<Uint8Array>;
  refresh(): Promise<unknown>;
}

export interface SigningJourneyOptions {
  store: SigningJourneyStore;
  source(kind: SigningJourneyKind, id: string): Promise<JourneySource>;
  document(
    kind: SigningJourneyKind,
    providerId: string,
  ): Promise<SignWellSigningDocument>;
  email: StaffEmailPort;
  origin: string;
  linkSecret: string;
  testRecipients: ReadonlySet<string>;
  now?: () => number;
}

const closed = new Set<SigningState>(["canceled", "declined", "expired"]);
const pending = new Set<SigningState>([
  "sent",
  "viewed",
  "awaiting_countersignature",
]);
const normalize = (email: string) => email.trim().toLowerCase();

export class SigningJourneyService {
  constructor(private readonly options: SigningJourneyOptions) {}

  private checked(source: JourneySource, doc: SignWellSigningDocument) {
    const state = signWellSigningState(doc, {
      bindingKey:
        source.kind === "mnda" ? "commerce_mnda_id" : "commerce_contract_id",
      id: source.id,
      templateHash: source.templateHash,
      testMode: source.testMode,
      providerId: source.providerId,
      signers: source.signers.map((s) => ({ id: s.id, emails: [s.email] })),
    });
    if (doc.metadata.commerce_signing_experience !== "fil_one")
      throw new Error("SIGNING_JOURNEY_NOT_EMBEDDED");
    return state;
  }

  /** Called from the already-durable commercial audit outbox, never from a
   * browser completion claim. Current records supersede delayed events. */
  async synchronize(
    kind: SigningJourneyKind,
    id: string,
    reminderEvent?: string,
    expectedProviderId?: string,
  ) {
    const source = await this.options.source(kind, id);
    if (expectedProviderId && source.providerId !== expectedProviderId) return;
    if (!source.providerId || closed.has(source.state)) {
      await this.options.store.revoke(kind, id, source.version);
      return;
    }
    if (source.pendingCorrection || source.state === "attention") return;
    const doc = await this.options.document(kind, source.providerId);
    if (doc.metadata.commerce_signing_experience !== "fil_one") {
      await this.options.store.revoke(kind, id, source.version);
      return;
    }
    const state = this.checked(source, doc);
    // Completion mail only follows the engine's atomic archive+completion.
    if (
      state !== source.state ||
      (!pending.has(state) && state !== "completed")
    )
      return;
    const recipients = source.signers.map((s) => ({
      slot: s.id,
      name: s.name,
      email: normalize(s.email),
      signed: ["signed", "completed"].includes(
        doc.recipients.find((r) => r.id === s.id)?.status?.toLowerCase() ?? "",
      ),
    }));
    const nextSlot = pending.has(state)
      ? (recipients.find((r) => !r.signed)?.slot ?? null)
      : null;
    const copies = source.copies
      .filter((c) => !recipients.some((r) => r.email === normalize(c.email)))
      .map((c) => ({
        slot: `copy:${normalize(c.email)}`,
        name: c.name,
        email: normalize(c.email),
        signed: false,
      }));
    const snapshot: SigningJourneySnapshot = {
      sourceVersion: source.version,
      kind,
      requestId: id,
      providerId: doc.id,
      title: source.title,
      testMode: source.testMode,
      state,
      recipients: [...recipients, ...copies],
      nextSlot,
    };
    await this.options.store.synchronize(snapshot, reminderEvent);
  }

  /** Every access checks the live Commerce binding, not just a valid token.
   * This immediately rejects replaced requests and corrected old addresses. */
  async sourceFor(recipient: SigningRecipient): Promise<JourneySource> {
    if (recipient.revoked) throw new Error("SIGNING_ACCESS_INVALID");
    const source = await this.options.source(
      recipient.kind,
      recipient.requestId,
    );
    const person = recipient.slot.startsWith("copy:")
      ? source.copies.find((c) => normalize(c.email) === recipient.email)
      : source.signers.find(
          (s) =>
            s.id === recipient.slot && normalize(s.email) === recipient.email,
        );
    if (
      source.providerId !== recipient.providerId ||
      !person ||
      source.testMode !== recipient.testMode
    )
      throw new Error("SIGNING_ACCESS_INVALID");
    if (source.pendingCorrection) throw new Error("SIGNING_CORRECTION_PENDING");
    return source;
  }

  async view(recipient: SigningRecipient): Promise<RecipientSigningView> {
    const source = await this.sourceFor(recipient);
    let state: RecipientSigningView["state"] = "waiting";
    if (closed.has(source.state)) state = "closed";
    else if (source.state === "completed") state = "completed";
    else if (source.state === "attention") state = "attention";
    else if (recipient.signed) state = "signed";
    else if (pending.has(source.state) && !recipient.slot.startsWith("copy:")) {
      if (recipient.nextToSign) state = "ready";
    }
    return {
      title: source.title,
      recipientName: recipient.name,
      state,
      testMode: source.testMode,
      canDownload: source.state === "completed",
    };
  }

  async launch(recipient: SigningRecipient): Promise<string> {
    const source = await this.sourceFor(recipient);
    if (!pending.has(source.state) || recipient.slot.startsWith("copy:"))
      throw new Error("SIGNING_NOT_READY");
    const doc = await this.options.document(source.kind, recipient.providerId);
    if (!pending.has(this.checked(source, doc)))
      throw new Error("SIGNING_NOT_READY");
    const next = doc.recipients.find(
      (r) => !["signed", "completed"].includes(r.status?.toLowerCase() ?? ""),
    );
    if (
      !doc.apply_signing_order ||
      !doc.recipients.every((r, i) => r.id === source.signers[i]?.id) ||
      next?.id !== recipient.slot ||
      !next.embedded_signing_url
    )
      throw new Error("SIGNING_NOT_READY");
    return signWellRecipientUrl(next.embedded_signing_url);
  }

  async refresh(recipient: SigningRecipient) {
    const source = await this.sourceFor(recipient);
    if (!closed.has(source.state) && source.state !== "completed")
      await source.refresh();
    await this.synchronize(source.kind, source.id);
    const current = await this.options.store.recipient(recipient.id);
    if (!current) throw new Error("SIGNING_ACCESS_INVALID");
    return this.view(current);
  }

  async download(recipient: SigningRecipient) {
    const source = await this.sourceFor(recipient);
    if (source.state !== "completed") throw new Error("SIGNING_NOT_COMPLETED");
    const bytes = await source.pdf();
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
      throw new Error("SIGNING_EVIDENCE_UNAVAILABLE");
    await this.options.store.recordAccess(recipient.id, "downloaded");
    return bytes;
  }

  /** A bounded, leased retry worker. SMTP acceptance cannot be atomic with
   * our database: an ambiguous timeout may repeat the same safe link. */
  async deliver(limit = 20) {
    let delivered = 0;
    for (let i = 0; i < limit; i++) {
      const job = await this.options.store.claim();
      if (!job) break;
      try {
        const recipient = await this.options.store.recipient(job.recipientId);
        if (
          !recipient ||
          recipient.nonce !== job.recipientNonce ||
          recipient.revoked
        ) {
          await this.options.store.finish(job, "skipped", "RECIPIENT_CHANGED");
          continue;
        }
        const view = await this.view(recipient);
        if (
          (job.purpose === "completed" && view.state !== "completed") ||
          (job.purpose !== "completed" && view.state !== "ready")
        ) {
          const temporary = ["attention", "waiting"].includes(view.state);
          await this.options.store.finish(
            job,
            temporary ? "deferred" : "skipped",
            "NO_LONGER_APPLICABLE",
          );
          continue;
        }
        if (
          recipient.testMode &&
          !this.options.testRecipients.has(recipient.email)
        ) {
          await this.options.store.finish(
            job,
            "failed",
            "TEST_RECIPIENT_NOT_ALLOWED",
          );
          continue;
        }
        const expires =
          Math.floor((this.options.now?.() ?? Date.now()) / 1000) +
          recipientLinkLifetimeSeconds;
        const token = recipientAccessToken(
          recipient,
          this.options.linkSecret,
          expires,
        );
        const href = `${this.options.origin}/sign/${recipient.id}#${token}`;
        const result = await this.options.email.send({
          to: recipient.email,
          ...signingEmail(recipient, job.purpose, href, this.options.origin),
        });
        await this.options.store.finish(
          job,
          result.ok
            ? "sent"
            : result.kind === "transient"
              ? "pending"
              : "failed",
          result.ok ? undefined : result.code,
        );
        if (result.ok) delivered++;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "SIGNING_CORRECTION_PENDING"
        ) {
          await this.options.store.finish(
            job,
            "deferred",
            "CORRECTION_PENDING",
          );
          continue;
        }
        const code =
          error instanceof Error && error.message === "SIGNING_ACCESS_INVALID"
            ? "RECIPIENT_CHANGED"
            : "SIGNING_DELIVERY_UNAVAILABLE";
        await this.options.store.finish(
          job,
          code === "RECIPIENT_CHANGED" ? "skipped" : "pending",
          code,
        );
      }
    }
    return { delivered };
  }
}
