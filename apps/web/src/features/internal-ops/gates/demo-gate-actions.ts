"use server";

import { hasPermission } from "@clockwork/contracts";
import type {
  ExternalGateConfiguredStatus,
  ExternalGateKey,
} from "@clockwork/domain/system";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { requireRecentAuthentication } from "@/src/auth/session";

import {
  testDemoExternalGateState,
  updateDemoExternalGateState,
  type DemoExternalGateView,
} from "./demo-gate-state";

async function operator() {
  if (!demoDeployIdentityEnabled(process.env))
    throw new Error("DEMO_GATE_UNAVAILABLE");
  const session = await requireRecentAuthentication();
  if (
    !session.isInternalStaff ||
    !session.roles.some((role) => hasPermission(role, "system:operate"))
  )
    throw new Error("DEMO_GATE_FORBIDDEN");
  return session;
}

export async function updateDemoExternalGate(
  gateKey: ExternalGateKey,
  input: {
    expectedRowVersion: number;
    owner: string;
    inputRequired: string;
    configuredStatus: ExternalGateConfiguredStatus;
    reviewOn: string | null;
    statusReason: string;
  },
): Promise<DemoExternalGateView> {
  await operator();
  return updateDemoExternalGateState({ gateKey, ...input });
}

export async function runDemoExternalGateActivationTest(
  gateKey: ExternalGateKey,
  expectedRowVersion: number,
): Promise<DemoExternalGateView> {
  const session = await operator();
  return testDemoExternalGateState({
    gateKey,
    expectedRowVersion,
    actorId: session.userId,
  });
}
