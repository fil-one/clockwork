import { describe, expect, it } from "vitest";

import { agreementTaskIds } from "../agreements";
import { exceptionTaskIds } from "../exceptions";
import { migrationTaskIds } from "../migrations";
import { offboardingTaskIds } from "../offboarding";
import { pocTaskIds } from "../pocs";
import { provisioningTaskIds } from "../provisioning";
import { renewalTaskIds } from "../renewals";
import { onboardingTaskIds } from ".";

describe("permanent lifecycle workflow task identifiers", () => {
  it("keeps every task lane-prefixed, versioned, and unique", () => {
    const taskIds = [
      ...Object.values(onboardingTaskIds),
      ...Object.values(agreementTaskIds),
      ...Object.values(provisioningTaskIds),
      ...Object.values(pocTaskIds),
      ...Object.values(renewalTaskIds),
      ...Object.values(offboardingTaskIds),
      ...Object.values(exceptionTaskIds),
      ...Object.values(migrationTaskIds),
    ];
    expect(new Set(taskIds).size).toBe(taskIds.length);
    expect(
      taskIds.every((taskId) => /^lifecycle-[a-z-]+-v\d+$/.test(taskId)),
    ).toBe(true);
  });
});
