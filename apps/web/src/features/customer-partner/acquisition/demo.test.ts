import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { demoPersonas } from "@clockwork/testing/personas";
vi.mock("server-only", () => ({}));
vi.mock("@/src/auth/demo-deploy", () => ({
  demoDeployIdentityEnabled: () => true,
}));
import { DemoCustomerAcquisitionRepository } from "./demo";
const owner = demoPersonas.directBuyer;
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing test fixture");
  return value;
}
const finance = demoPersonas.financeApprover;
let repository: DemoCustomerAcquisitionRepository;
beforeEach(() => {
  repository = new DemoCustomerAcquisitionRepository(createMemoryDemoStore());
});
const now = "2026-09-06T12:00:00.000Z";
it("retains assent across reads, enforces idempotency and keeps handoff pending", async () => {
  const view = await repository.list({
    userId: owner.userId,
    accountId: owner.selectedAccountId,
    now,
  });
  const offer = required(view.offers[0]);
  const command = {
    kind: "trial" as const,
    id: crypto.randomUUID(),
    accountId: owner.selectedAccountId,
    organizationId: owner.organizationId,
    offerVersionId: offer.id,
    offerRowVersion: offer.rowVersion,
    offerFingerprint: offer.fingerprint,
    acceptedTerms: true as const,
  };
  const pending = await repository.request({
    command,
    userId: owner.userId,
    now,
  });
  expect(pending.status).toBe("pending");
  expect(pending.result).toBeNull();
  expect(
    await repository.request({ command, userId: owner.userId, now }),
  ).toEqual(expect.objectContaining(pending));
  expect(
    (
      await repository.list({
        userId: owner.userId,
        accountId: owner.selectedAccountId,
        now,
      })
    ).requests,
  ).toHaveLength(1);
  await expect(
    repository.request({
      command: { ...command, id: crypto.randomUUID() },
      userId: owner.userId,
      now,
    }),
  ).rejects.toThrow("REQUEST_PENDING");
  await expect(
    repository.resolve({
      command: {
        id: command.id,
        expectedRowVersion: 1,
        decision: "fulfilled",
        reason: "Fictional verified handoff",
      },
      userId: owner.userId,
      now,
    }),
  ).rejects.toThrow("FINANCE_REQUIRED");
  const linked = await repository.resolve({
    command: {
      id: command.id,
      expectedRowVersion: 1,
      decision: "fulfilled",
      reason: "Fictional verified handoff",
    },
    userId: finance.userId,
    now,
  });
  expect(linked.result?.kind).toBe("trial");
  await expect(
    repository.request({
      command: { ...command, id: crypto.randomUUID() },
      userId: owner.userId,
      now,
    }),
  ).rejects.toThrow("TRIAL_ALREADY_USED");
  const conversion = await repository.request({
    command: {
      ...command,
      id: crypto.randomUUID(),
      kind: "convert_to_payg",
      trialId: required(linked.result).id,
    },
    userId: owner.userId,
    now,
  });
  const paid = await repository.resolve({
    command: {
      id: conversion.id,
      expectedRowVersion: 1,
      decision: "fulfilled",
      reason: "Fictional paid handoff confirmed",
    },
    userId: finance.userId,
    now,
  });
  expect(paid.result?.billingAuthority).toBe("fictional_demo");
  const cancel = await repository.request({
    command: {
      kind: "cancel_payg",
      id: crypto.randomUUID(),
      accountId: owner.selectedAccountId,
      organizationId: owner.organizationId,
      enrollmentId: required(paid.result).id,
      reason: "Customer no longer needs this service",
    },
    userId: owner.userId,
    now,
  });
  expect(cancel.result).toBeNull();
  await repository.resolve({
    command: {
      id: cancel.id,
      expectedRowVersion: 1,
      decision: "fulfilled",
      reason: "Fictional service end confirmed",
    },
    userId: finance.userId,
    now,
  });
  const final = await repository.list({
    userId: owner.userId,
    accountId: owner.selectedAccountId,
    now,
  });
  expect(final.requests.find((row) => row.id === paid.id)?.result?.endsAt).toBe(
    now,
  );
  expect(
    final.requests.find((row) => row.id === linked.id)?.result?.convertedAt,
  ).toBe(now);
});
it("rejects cross-account, stale offer and provider authority injection", async () => {
  const view = await repository.list({
    userId: owner.userId,
    accountId: owner.selectedAccountId,
    now,
  });
  const offer = required(view.offers[0]);
  const command = {
    kind: "payg" as const,
    id: crypto.randomUUID(),
    accountId: owner.selectedAccountId,
    organizationId: owner.organizationId,
    offerVersionId: offer.id,
    offerRowVersion: offer.rowVersion,
    offerFingerprint: offer.fingerprint,
    acceptedTerms: true as const,
  };
  await expect(
    repository.request({
      command: { ...command, accountId: crypto.randomUUID() },
      userId: owner.userId,
      now,
    }),
  ).rejects.toThrow("ACCOUNT_AUTHORITY");
  await expect(
    repository.request({
      command: { ...command, offerFingerprint: "a".repeat(64) },
      userId: owner.userId,
      now,
    }),
  ).rejects.toThrow("OFFER_CHANGED");
  await expect(
    repository.request({
      command: { ...command, billingAuthority: "clockwork" } as typeof command,
      userId: owner.userId,
      now,
    }),
  ).rejects.toThrow();
});

it("keeps the approved demo offer fingerprint stable between browsing and next-day acceptance", async () => {
  const first = await repository.list({
    userId: owner.userId,
    accountId: owner.selectedAccountId,
    now,
  });
  const offer = first.offers[0];
  if (!offer) throw new Error("Missing demo offer");
  const later = "2026-09-07T12:00:01.000Z";
  const next = await repository.list({
    userId: owner.userId,
    accountId: owner.selectedAccountId,
    now: later,
  });
  expect(next.offers.find((row) => row.id === offer.id)).toEqual(offer);
  await expect(
    repository.request({
      command: {
        kind: "trial",
        id: crypto.randomUUID(),
        accountId: owner.selectedAccountId,
        organizationId: owner.organizationId,
        offerVersionId: offer.id,
        offerRowVersion: offer.rowVersion,
        offerFingerprint: offer.fingerprint,
        acceptedTerms: true,
      },
      userId: owner.userId,
      now: later,
    }),
  ).resolves.toMatchObject({ status: "pending", result: null });
});
it("states the fictional offer and organization in the reader's language without changing the evidence", async () => {
  const server = await import("@/src/i18n/server");
  const english = await repository.list({
    userId: owner.userId,
    accountId: owner.selectedAccountId,
    now,
  });
  const reader = vi
    .spyOn(server, "getLocale")
    .mockImplementation(() => Promise.resolve("pt"));
  try {
    const portuguese = await repository.list({
      userId: owner.userId,
      accountId: owner.selectedAccountId,
      now,
    });
    const before = required(english.offers[0]);
    const after = required(portuguese.offers[0]);
    expect(after.name).toBe("Armazenamento fictício sem prazo");
    expect(after.notices.serviceNotice).toMatch(/^Apenas uma demonstração/u);
    expect(portuguese.organizations[0]?.name).toBe(
      "Organização cliente fictícia",
    );
    // The fingerprint a request must match is computed from the stored terms.
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.rowVersion).toBe(before.rowVersion);
  } finally {
    reader.mockRestore();
  }
});
