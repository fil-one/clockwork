import { coreDomainRegistry } from "@clockwork/domain/core";
import { lifecycleDomainRegistry } from "@clockwork/domain/lifecycle";
import { lifecycleIntegrationRegistry } from "@clockwork/integrations/lifecycle";
import { coreWorkflowRegistry } from "@clockwork/workflows/core";
import { lifecycleWorkflowRegistry } from "@clockwork/workflows/lifecycle";
import { describe, expect, it } from "vitest";

describe("lane package composition", () => {
  it("exports every domain and provider family through stable subpaths", () => {
    expect(coreDomainRegistry).toHaveLength(10);
    expect(lifecycleDomainRegistry).toEqual([
      "agreements",
      "compliance",
      "exceptions",
      "identity",
      "migrations",
      "pocs",
      "provisioning",
      "renewals",
      "terminations",
    ]);
    expect(lifecycleIntegrationRegistry).toHaveLength(9);
  });

  it("publishes complete, collision-free workflow task registries", () => {
    expect(coreWorkflowRegistry).toHaveLength(8);
    expect(lifecycleWorkflowRegistry).toHaveLength(24);
    expect(new Set(lifecycleWorkflowRegistry).size).toBe(
      lifecycleWorkflowRegistry.length,
    );
    expect(lifecycleWorkflowRegistry).toContain(
      "lifecycle-offboarding-teardown-v1",
    );
    expect(lifecycleWorkflowRegistry).toContain(
      "lifecycle-migrations-review-wait-v1",
    );
  });
});
