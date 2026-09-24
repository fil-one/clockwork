import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DeadLetterOperation } from "@clockwork/db";

import { translatorFor } from "@/src/i18n/catalogs";

vi.mock("@/src/features/shell/permission-gate", () => ({
  SurfaceActionGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./actions", () => ({ decideDeadLetterOperation: vi.fn() }));

import { recoverySubject, RecoveryView } from "./recovery-view";

const invoiceDispatch: DeadLetterOperation = {
  id: "0f4b8a4e-5f3a-4c55-9d2b-7a1e0c9d2b11",
  source: "outbox_message",
  reference: "billing.invoice.collection_requested",
  subjectType: "invoice",
  subjectId: "INV-2026-0781",
  accountId: null,
  failureCode: "DELIVERY_ATTEMPTS_EXHAUSTED",
  attemptCount: 8,
  failedAt: "2026-07-31T13:24:00.000Z",
  redriveKey: null,
  decision: "open",
  decisionReason: null,
  decidedAt: null,
};

const orderAttempt: DeadLetterOperation = {
  ...invoiceDispatch,
  id: "5b7f2a61-9c1e-4f0a-8d33-2c4e6a8b0d91",
  source: "provisioning_attempt",
  reference: "activate_subscription",
  subjectType: "order",
  subjectId: "3c9e1f7a-2b4d-4e6f-8a0c-1d2e3f4a5b6c",
  failureCode: "PROVIDER_TIMEOUT",
};

describe("stopped work", () => {
  /**
   * The record column used to cut every subject to eight characters, which
   * suits a UUID and turned the invoice reference `INV-2026-0781` into
   * `INV-2026` -- a different-looking reference an operator would search for
   * and not find.
   */
  it("shows a readable reference whole and shortens only a UUID", () => {
    const t = translatorFor("en");
    expect(recoverySubject(invoiceDispatch, t)).toBe("Invoice INV-2026-0781");
    expect(recoverySubject(orderAttempt, t)).toBe("Order 3c9e1f7a");
  });

  it("names the subject kind in the reader's language", () => {
    expect(recoverySubject(invoiceDispatch, translatorFor("pt"))).toBe(
      "Fatura INV-2026-0781",
    );
    expect(recoverySubject(orderAttempt, translatorFor("de"))).toBe(
      "Auftrag 3c9e1f7a",
    );
  });

  it("renders the engine, the full reference and how long it has waited", () => {
    render(
      <RecoveryView
        result={{
          operations: [invoiceDispatch],
          source: "demo",
          readable: true,
        }}
        now={new Date("2026-07-31T16:30:00.000Z")}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("Dispatch queue")).toBeVisible();
    expect(within(table).getByText("Invoice INV-2026-0781")).toBeVisible();
    expect(within(table).getByText("3 hours")).toBeVisible();
    expect(screen.getByText("1 record")).toBeVisible();
  });
});
