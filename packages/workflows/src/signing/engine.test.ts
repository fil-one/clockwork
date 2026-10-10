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

  it("declares a correctable signer only where the store and client can correct it", () => {
    const correctable = {
      ...contractSigning,
      slots: contractSigning.slots.map((slot, index) => ({
        ...slot,
        correctable: index === 0,
      })),
    };
    expect(
      () =>
        new SigningEngine<ContractSigningRecord>(
          correctable,
          contractStore(),
          signWell(),
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

  it("declares no cancel code or signer correction", () => {
    expect([...contractStore().capabilities]).toEqual([]);
  });

  it("refuses a change it cannot store rather than drop part of it", async () => {
    const update = vi.fn(async () => record);
    const store = contractStore(update);
    await expect(
      store.update(record, "token", { pendingSignerEmail: "a@b.co" }, actor),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    await expect(
      store.update(record, "token", { correctedSignerEmail: "a@b.co" }, actor),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    await expect(
      store.update(
        record,
        "token",
        { state: "canceled", cancelCode: "voided", cancelReason: "Wrong" },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    await expect(
      store.update(record, "token", { error: null }, actor, undefined, {
        eventType: "contract.signer_corrected",
        before: { signerEmail: "a@b.co" },
      }),
    ).rejects.toThrow("CONTRACT_SIGNING_CHANGE_NOT_STORABLE");
    expect(update).not.toHaveBeenCalled();
    await store.update(record, "token", { state: "sent", error: null }, actor);
    expect(update).toHaveBeenCalledExactlyOnceWith(
      record.contractId,
      "token",
      { state: "sent", error: null },
      actor,
      undefined,
      undefined,
    );
  });
});
