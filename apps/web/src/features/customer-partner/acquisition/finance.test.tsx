import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CustomerAcquisitionRequest } from "@clockwork/domain/core";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { effectiveCustomerOffers } from "@clockwork/domain/core";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";
import styles from "@/src/features/internal-ops/administration-safety/administration-safety.module.css";

vi.mock("server-only", () => ({}));
vi.mock("./actions", () => ({ resolveCustomerAcquisition: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { currentDemoPaygPolicies } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { AcquisitionFinance } from "./finance";

const now = "2026-09-06T12:00:00.000Z";
const [offer] = effectiveCustomerOffers(
  currentDemoPaygPolicies(createPristineDemoAdapterState(), now),
  now,
);

function request(
  id: string,
  status: CustomerAcquisitionRequest["status"],
): CustomerAcquisitionRequest {
  if (!offer) throw new Error("the demo publishes one customer offer");
  return {
    id,
    accountId: "11000000-0000-4000-8000-000000000001",
    organizationId: "31000000-0000-4000-8000-000000000001",
    organizationName: "Example organization",
    kind: "trial",
    status,
    rowVersion: 1,
    acceptedAt: now,
    offer,
    reason: "",
    resolutionReason: null,
    trialId: null,
    enrollmentId: null,
    result: null,
  };
}

/**
 * The finance queue showed the stored code ("fulfilled") in an uncoloured
 * chip: untranslated, and neutral whatever the state, because the shared pill
 * no longer guesses its colour from English words.
 */
it("states each request in the reader's language, coloured by its state", () => {
  render(
    <LanguageProvider catalog={catalogs.pt} locale="pt">
      <AcquisitionFinance
        requests={[
          request("81000000-0000-4000-8000-000000000001", "pending"),
          request("81000000-0000-4000-8000-000000000002", "fulfilled"),
          request("81000000-0000-4000-8000-000000000003", "declined"),
        ]}
        demo
        available
      />
    </LanguageProvider>,
  );
  expect(screen.queryByText("fulfilled")).toBeNull();
  expect(screen.getByText("Aguardando encaminhamento verificado")).toHaveClass(
    styles.warning ?? "",
  );
  expect(screen.getByText("Registro de serviço vinculado")).toHaveClass(
    styles.success ?? "",
  );
  expect(screen.getByText("Recusada")).toHaveClass(styles.danger ?? "");
});
