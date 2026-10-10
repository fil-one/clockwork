/* eslint-disable @typescript-eslint/require-await -- in-memory repository fakes model the async contract. */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  contractSigning,
  mndaSigning,
  type ContractSigningRecord,
  type MndaRecord,
} from "@clockwork/contracts";
import { fixtureSigningRecord } from "../../../contracts/src/contract-fixture";
import { SigningEngine, type SignWellCalls } from "./engine";
import {
  contractSigningStore,
  mndaSigningStore,
  type ContractSigningStoreRepository,
  type MndaSigningRepository,
} from "./stores";

function signWell<R>(correct = true): SignWellCalls<R> {
  return {
    createDraft: vi.fn(),
    get: vi.fn(),
    send: vi.fn(),
    remind: vi.fn(),
    cancel: vi.fn(),
    completedPdf: vi.fn(),
    ...(correct ? { updateRecipient: vi.fn() } : {}),
  };
}
const mndaStore = () => mndaSigningStore({} as MndaSigningRepository);
const contractStore = (update = vi.fn()) =>
  contractSigningStore({ update } as unknown as ContractSigningStoreRepository);

describe("the signing engine refuses a declaration it cannot honour", () => {
  it("needs exactly two signers", () => {
    const one = { ...mndaSigning, slots: mndaSigning.slots.slice(0, 1) };
    expect(
      () => new SigningEngine<MndaRecord>(one, mndaStore(), signWell()),
    ).toThrow("needs exactly two signers");
  });

  it("corrects at most one signer", () => {
    const both = {
      ...mndaSigning,
      slots: mndaSigning.slots.map((slot) => ({ ...slot, correctable: true })),
    };
    expect(
      () => new SigningEngine<MndaRecord>(both, mndaStore(), signWell()),
    ).toThrow("at most one signer");
  });

  it("declares captured fields only where the store can keep them", () => {
    const capturing = {
      ...contractSigning,
      capture: [{ apiId: "company_sign", searchable: true }],
    };
    expect(
      () =>
        new SigningEngine<ContractSigningRecord>(
          capturing,
          contractStore(),
          signWell(),
        ),
    ).toThrow("CONTRACT declares captured fields its store cannot keep");
    expect(contractSigning.capture).toBeUndefined();
    expect(mndaSigning.capture?.length).toBeGreaterThan(0);
    expect(
      () => new SigningEngine<MndaRecord>(mndaSigning, mndaStore(), signWell()),
    ).not.toThrow();
  });

  it("declares a correctable signer only where the store and client can correct it", () => {
    const uncorrectable = {
      ...contractStore(),
      capabilities: new Set<"cancel_code">(["cancel_code"]),
    };
    expect(
      () =>
        new SigningEngine<ContractSigningRecord>(
          contractSigning,
          uncorrectable,
          signWell(),
        ),
    ).toThrow("CONTRACT declares a correctable signer");
    expect(
      () =>
        new SigningEngine<ContractSigningRecord>(
          contractSigning,
          contractStore(),
          signWell(false),
        ),
    ).toThrow("CONTRACT declares a correctable signer");
    expect(
      () =>
        new SigningEngine<MndaRecord>(
          mndaSigning,
          mndaStore(),
          signWell(false),
        ),
    ).toThrow("MNDA declares a correctable signer");
    expect(
      () =>
        new SigningEngine<ContractSigningRecord>(
          contractSigning,
          contractStore(),
          signWell(),
        ),
    ).not.toThrow();
  });
});

describe("the contract store", () => {
  const record = structuredClone(fixtureSigningRecord);
  const actor = { kind: "user" as const, id: randomUUID() };

  it("keeps signer corrections and cancel codes (001459), not captured fields", () => {
    expect([...contractStore().capabilities]).toEqual([
      "signer_correction",
      "cancel_code",
    ]);
  });

  it("refuses a change it cannot store rather than drop part of it", async () => {
    const update = vi.fn(async () => record);
    const store = contractStore(update);
    await expect(
      store.update(
        record,
        "token",
        { state: "canceled", cancelCode: "superseded" },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    await expect(
      store.update(
        record,
        "token",
        { sentAt: new Date() } as unknown as { state: "sent" },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    await expect(
      store.update(record, "token", { state: "sent" }, actor, undefined, {
        detail: { copiedContacts: "verified" },
      }),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    await expect(
      store.update(
        record,
        "token",
        { state: "completed", error: null, capturedFields: {} },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    await expect(
      store.update(record, "token", { state: "completed" }, actor, undefined, {
        followUp: { eventType: "contract.fields_unreported" },
      }),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    expect(update).not.toHaveBeenCalled();
  });

  it("passes corrections, cancel codes and before-images to the repository", async () => {
    const update = vi.fn(async () => record);
    const store = contractStore(update);
    await store.update(
      record,
      "token",
      { correctedSignerEmail: "a@b.co", pendingSignerEmail: null },
      actor,
      undefined,
      {
        eventType: "contract.signer_corrected",
        before: { signerEmail: "old@b.co" },
        detail: { signerEmail: "a@b.co" },
      },
    );
    expect(update).toHaveBeenLastCalledWith(
      record.contractId,
      "token",
      { correctedSignerEmail: "a@b.co", pendingSignerEmail: null },
      actor,
      undefined,
      {
        eventType: "contract.signer_corrected",
        detail: { signerEmail: "a@b.co" },
        before: { signerEmail: "old@b.co" },
      },
    );
    await store.update(
      record,
      "token",
      {
        state: "canceled",
        error: null,
        cancelCode: "voided",
        cancelReason: "Wrong",
      },
      actor,
    );
    expect(update).toHaveBeenLastCalledWith(
      record.contractId,
      "token",
      {
        state: "canceled",
        error: null,
        cancelCode: "voided",
        cancelReason: "Wrong",
      },
      actor,
      undefined,
      undefined,
    );
  });
});
