import { describe, expect, it } from "vitest";

import {
  createEnvironmentWorkflowAdapterFactory,
  WorkflowEnvironmentAdapterConfigurationError,
} from "./environment-production-adapters";

const completeEnvironment = {
  NODE_ENV: "test",
  AUTHORIZATION_CONTEXT_SECRET: "test-authorization-context-secret",
  WORKFLOW_PROVIDER_CONTROL_BASE_URL: "https://control.example/",
  WORKFLOW_PROVIDER_CONTROL_TOKEN: "control-token",
  ACCOUNTING_PROVIDER_BASE_URL: "https://accounting.example/",
  ACCOUNTING_PROVIDER_TOKEN: "accounting-token",
  NOTIFICATION_PROVIDER_BASE_URL: "https://notifications.example/",
  NOTIFICATION_PROVIDER_TOKEN: "notification-token",
  USAGE_PROVIDER_BASE_URL: "https://usage.example/",
  USAGE_PROVIDER_TOKEN: "usage-token",
  PROVISIONING_PROVIDER_BASE_URL: "https://provisioning.example/",
  PROVISIONING_PROVIDER_TOKEN: "provisioning-token",
  SCREENING_PROVIDER_BASE_URL: "https://screening.example/",
  SCREENING_PROVIDER_TOKEN: "screening-token",
  SIGNATURE_PROVIDER_BASE_URL: "https://signature.example/",
  SIGNATURE_PROVIDER_TOKEN: "signature-token",
  SIGNATURE_PROVIDER_SIGNING_ORIGINS_JSON: JSON.stringify([
    "https://signing.example",
  ]),
  EVIDENCE_PROVIDER_BASE_URL: "https://evidence.example/",
  EVIDENCE_PROVIDER_TOKEN: "evidence-token",
  TAX_PROVIDER_BASE_URL: "https://tax.example/",
  TAX_PROVIDER_TOKEN: "tax-token",
  DOCUMENT_RENDERER_PROVIDER_BASE_URL: "https://documents.example/",
  DOCUMENT_RENDERER_PROVIDER_TOKEN: "document-renderer-token",
  WORKOS_MFA_PROVIDER_BASE_URL: "https://workos-policy.example/",
  WORKOS_MFA_PROVIDER_TOKEN: "workos-policy-token",
  STRIPE_SECRET_KEY: "sk_test_clockwork_provider",
  WORKOS_API_KEY: "sk_test_workos_provider",
  PLATFORM_ISSUER_JSON: JSON.stringify({
    legalName: "Fil One, Inc.",
    address: {
      line1: "1 Commerce Way",
      locality: "New York",
      postalCode: "10001",
      countryCode: "US",
    },
  }),
  WORKFLOW_EXCEPTION_ROUTES_JSON: JSON.stringify([
    {
      queue: "reporting",
      accountId: "10000000-0000-4000-8000-000000000001",
      ownerUserId: "20000000-0000-4000-8000-000000000001",
      backupUserId: "20000000-0000-4000-8000-000000000002",
      objectType: "workflow_exception",
      targetMinutes: 60,
    },
  ]),
};

describe("environment production workflow adapters", () => {
  it("builds the default live adapter factory from complete registered inputs", () => {
    expect(() =>
      createEnvironmentWorkflowAdapterFactory(completeEnvironment),
    ).not.toThrow();
  });

  it("does not accept queue-to-account ownership from environment state", () => {
    const withoutStaticRoutes = {
      ...completeEnvironment,
      WORKFLOW_EXCEPTION_ROUTES_JSON: undefined,
    };
    expect(() =>
      createEnvironmentWorkflowAdapterFactory(withoutStaticRoutes),
    ).not.toThrow();
  });

  it("fails closed with the exact external input and gate", () => {
    let failure: unknown;
    try {
      createEnvironmentWorkflowAdapterFactory({
        ...completeEnvironment,
        EVIDENCE_PROVIDER_TOKEN: undefined,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(
      WorkflowEnvironmentAdapterConfigurationError,
    );
    if (!(failure instanceof WorkflowEnvironmentAdapterConfigurationError))
      throw new Error("Expected environment configuration failure");
    expect(failure.missing).toEqual(["EVIDENCE_PROVIDER_TOKEN"]);
    expect(failure.externalGates).toEqual(["EXT-ACC-01"]);
  });

  // P0-61: the composition had no tax slot at all, so there was nothing for an
  // absent tax engine to fail on and every invoice was written net. It now
  // fails closed on the exact absent input and names the gate that supplies it.
  it("fails closed on the tax provider under EXT-TAX-01", () => {
    let failure: unknown;
    try {
      createEnvironmentWorkflowAdapterFactory({
        ...completeEnvironment,
        TAX_PROVIDER_BASE_URL: undefined,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(
      WorkflowEnvironmentAdapterConfigurationError,
    );
    if (!(failure instanceof WorkflowEnvironmentAdapterConfigurationError))
      throw new Error("Expected environment configuration failure");
    expect(failure.missing).toEqual(["TAX_PROVIDER_BASE_URL"]);
    expect(failure.externalGates).toEqual(["EXT-TAX-01"]);
  });

  it("never enables provider simulators in production discovery", () => {
    expect(() =>
      createEnvironmentWorkflowAdapterFactory({
        ...completeEnvironment,
        NODE_ENV: "production",
        CLOCKWORK_ENABLE_SIMULATORS: "true",
      }),
    ).toThrow("CLOCKWORK_ENABLE_SIMULATORS:production_forbidden");
  });
});
