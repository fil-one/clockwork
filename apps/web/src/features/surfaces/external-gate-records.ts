import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";
import {
  gates as deterministicDemoGates,
  type DemoRecord,
} from "@/src/features/shared/demo-data";

const statusPresentation = {
  active: { status: "status.active", tone: "success", risk: "low" },
  blocked: { status: "status.blocked", tone: "danger", risk: "high" },
  review: { status: "status.review", tone: "warning", risk: "medium" },
  pending: { status: "status.pending", tone: "neutral", risk: "medium" },
  not_required: {
    status: "status.complete",
    tone: "neutral",
    risk: "low",
  },
} as const;

export function externalGateRecords(
  gates: readonly GeneratedExternalGate[],
): readonly DemoRecord[] {
  return gates.map((gate) => {
    const presentation = statusPresentation[gate.effectiveStatus];
    return {
      id: gate.gateKey,
      title: gate.title,
      meta: [
        `Owner: ${gate.owner}`,
        `Input: ${gate.inputRequired}`,
        `Affected: ${gate.affectedFeature}`,
        `Simulator: ${gate.simulatorState} — ${gate.simulatorDetails}`,
        `Activation test: ${gate.lastActivationTestStatus} at ${gate.lastActivationTestAt ?? "never"} by ${gate.lastActivationTestedBy ?? "unassigned"}`,
        `Evidence: ${gate.activationEvidenceReference ?? "missing"}`,
        `Review: ${gate.reviewOn ?? "unscheduled"}`,
        `Reason: ${gate.statusReason}`,
      ].join(" · "),
      status: presentation.status,
      tone: presentation.tone,
      value: gate.activationAllowed
        ? `Activation eligible · ${gate.severity.replaceAll("_", " ")}`
        : `Blocked: ${gate.blockedReasons.join(", ") || "configured status is not active"}`,
      risk: presentation.risk,
    };
  });
}

const unavailableGateRegistry = [
  {
    id: "GATE-REGISTRY-UNAVAILABLE",
    title: "Gate registry unavailable",
    meta: "Persistent activation status could not be loaded. No external gate is considered active.",
    status: "status.blocked",
    tone: "danger",
    value: "Activation denied",
    risk: "high",
  },
] as const satisfies readonly DemoRecord[];

export function externalGateFallback(
  runtimeEnvironment: string | undefined,
): readonly DemoRecord[] {
  return runtimeEnvironment === "development" || runtimeEnvironment === "test"
    ? deterministicDemoGates
    : unavailableGateRegistry;
}
