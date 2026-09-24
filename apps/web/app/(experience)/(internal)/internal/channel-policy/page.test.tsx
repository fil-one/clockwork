import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";

vi.mock("server-only", () => ({}));
vi.mock("@/src/auth/demo-deploy", () => ({
  demoDeployIdentityEnabled: () => true,
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: () =>
    Promise.resolve({
      isInternalStaff: true,
      providerBacked: false,
      roles: ["finance_approver"],
    }),
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: () => undefined,
}));
vi.mock("@/src/features/experience-server/demo-state-store", () => {
  const store = createMemoryDemoStore();
  return { configuredDemoStateStore: () => store };
});
vi.mock("./forms", () => ({
  ChannelDecisionForm: () => null,
  ChannelTermsForm: () => null,
}));
vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  return {
    getTranslations: () => Promise.resolve(translatorFor("es")),
    getLocale: () => Promise.resolve("es"),
    getFormattingLocale: () => Promise.resolve("es-ES"),
  };
});

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import {
  DemoCommercialPolicyRepository,
  localizeDemoChannelPolicy,
} from "@/src/features/internal-ops/commercial-policies/demo-policies";

import Page from "./page";

/**
 * The seeded channel policy stores its source evidence and decision reason in
 * English, like a record someone typed. This page resolved only `demoText`
 * values, so a Spanish finance approver read both sentences in English.
 */
it("shows the demo policy's own text in the reader's language", async () => {
  render(await Page());
  expect(
    screen.queryByText(/Fictional demo channel program/u),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Fictional proposal prepared by/u),
  ).not.toBeInTheDocument();
  const [stored] = await new DemoCommercialPolicyRepository(
    configuredDemoStateStore(),
  ).listChannel();
  if (!stored) throw new Error("the demo seeds a channel policy");
  const spanish = localizeDemoChannelPolicy(stored, "es");
  expect(spanish.terms.sourceEvidence).not.toBe(stored.terms.sourceEvidence);
  expect(screen.getByText(spanish.terms.sourceEvidence)).toBeVisible();
  expect(screen.getByText(spanish.decisionReason)).toBeVisible();
});
