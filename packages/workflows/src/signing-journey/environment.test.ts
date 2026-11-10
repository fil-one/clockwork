import { expect, it } from "vitest";
import {
  signingCreationOptions,
  signingJourneyConfiguration,
} from "./environment";
const configured = {
  NODE_ENV: "test",
  COMMERCE_SIGNING_EXPERIENCE: "fil_one",
  COMMERCE_SIGNING_LINK_SECRET:
    "test-signing-secret-of-at-least-thirty-two-characters",
  SIGNWELL_API_APPLICATION_ID: "019a44ac-0000-7000-8000-000000000004",
  SIGNWELL_API_KEY: "test-signwell-key",
  SIGNWELL_WEBHOOK_ID: "test-webhook-id",
  COMMERCE_SIGNING_ORIGIN: "https://commerce.example.test",
  COMMERCE_SIGNING_EMAIL_PROVIDER: "ses",
  COMMERCE_SIGNING_EMAIL_FROM: "Fil One <signing@example.test>",
  AWS_REGION: "us-east-1",
};
it("fails closed before creating a branded draft when any delivery setting is missing", () => {
  expect(signingCreationOptions({})).toBeUndefined();
  expect(signingCreationOptions(configured)).toEqual({
    applicationId: configured.SIGNWELL_API_APPLICATION_ID,
    logoUrl: "https://commerce.example.test/brand/fo-wordmark-dark.png",
  });
  for (const key of [
    "COMMERCE_SIGNING_LINK_SECRET",
    "SIGNWELL_API_APPLICATION_ID",
    "COMMERCE_SIGNING_ORIGIN",
    "COMMERCE_SIGNING_EMAIL_FROM",
    "COMMERCE_SIGNING_EMAIL_PROVIDER",
    "SIGNWELL_WEBHOOK_ID",
  ])
    expect(() => signingCreationOptions({ ...configured, [key]: "" })).toThrow(
      "NOT_CONFIGURED",
    );
  expect(() =>
    signingCreationOptions({
      ...configured,
      COMMERCE_SIGNING_ORIGIN: "https://commerce.example.test/path",
    }),
  ).toThrow();
});
it("keeps old links configured when new creation is switched back and blocks demo mail", () => {
  const rollback = { ...configured, COMMERCE_SIGNING_EXPERIENCE: "signwell" };
  expect(signingJourneyConfiguration(rollback).ready).toBe(true);
  expect(signingCreationOptions(rollback)).toBeUndefined();
  expect(
    signingJourneyConfiguration({
      ...configured,
      CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
    }).ready,
  ).toBe(false);
});
