import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";

import { adminSafetyCopy } from "./copy";
import type { GateGroup, GateRecord } from "./data";
import { canDecide } from "./policy";
import {
  AdministrationPage,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

const groupOrder: readonly GateGroup[] = [
  "Provider",
  "Legal",
  "Brand",
  "Operations",
];

function gateGroup(key: GeneratedExternalGate["gateKey"]): GateGroup {
  if (["EXT-LEGAL-01", "EXT-TAX-01"].includes(key)) return "Legal";
  if (["EXT-BRAND-01", "EXT-MARKETPLACE-01"].includes(key)) return "Brand";
  if (
    [
      "EXT-COMMERCIAL-01",
      "EXT-APPROVERS-01",
      "EXT-TEARDOWN-01",
      "EXT-MIGRATION-01",
    ].includes(key)
  )
    return "Operations";
  return "Provider";
}

function severityLabel(value: string): GateRecord["severity"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("launch") || normalized.includes("country"))
    return "Launch blocker";
  if (normalized.includes("path") || normalized.includes("block"))
    return "Path blocker";
  if (normalized.includes("medium")) return "Medium";
  return "High";
}

function stateLabel(
  state: GeneratedExternalGate["effectiveStatus"],
): GateRecord["state"] {
  if (state === "active" || state === "not_required") return "Active";
  if (state === "review") return "Review";
  if (state === "pending") return "Pending";
  return "Blocked";
}

export function presentGeneratedGate(gate: GeneratedExternalGate): GateRecord {
  const tested = gate.lastActivationTestAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(gate.lastActivationTestAt))
    : "never";
  const updated = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(gate.updatedAt));
  return {
    id: gate.gateKey,
    group: gateGroup(gate.gateKey),
    title: gate.title,
    owner: gate.owner,
    capability: gate.affectedFeature,
    activationTest: `${gate.lastActivationTestStatus} · ${tested} · ${gate.simulatorDetails}`,
    severity: severityLabel(gate.severity),
    state: stateLabel(gate.effectiveStatus),
    freshness: `Updated ${updated}`,
    reason: gate.statusReason,
    ...(gate.activationEvidenceReference
      ? { technicalEvidence: gate.activationEvidenceReference }
      : {}),
  };
}

export function GateRegister({
  roles,
  gates,
  source,
}: {
  roles: readonly string[];
  gates: readonly GateRecord[];
  source: "System gate registry" | "Fail-closed operational fallback";
}) {
  const mayOperate = canDecide(roles, "assisted");
  return (
    <AdministrationPage {...adminSafetyCopy.gates}>
      <section className={styles.notice} role="note">
        <strong>{source}</strong>
        Activation is fail-closed. A configured “active” state is insufficient
        without a current passing test, evidence, owner, and review date.
      </section>

      {!mayOperate ? (
        <section className={styles.roleNotice} role="note">
          <strong>Read-only gate register.</strong>
          Only an internal operator with recent authentication may update a gate
          or run an activation test.
        </section>
      ) : null}

      <div className={styles.gateGroups}>
        {groupOrder.map((group) => {
          const groupGates = gates.filter((gate) => gate.group === group);
          const blockers = groupGates.filter(
            (gate) => gate.state === "Blocked",
          ).length;
          return (
            <section
              className={styles.panel}
              key={group}
              aria-labelledby={`gate-group-${group.toLowerCase()}`}
            >
              <div className={styles.panelHeading}>
                <div>
                  <h2 id={`gate-group-${group.toLowerCase()}`}>{group}</h2>
                  <p>
                    {groupGates.length} gates · {blockers} blocked
                  </p>
                </div>
                <StatusPill
                  state={blockers ? `${blockers} blockers` : "No blockers"}
                />
              </div>
              {groupGates.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <caption className={styles.srOnly}>
                      {group} external activation gates
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Gate</th>
                        <th scope="col">Owner</th>
                        <th scope="col">Affected capability</th>
                        <th scope="col">Activation test</th>
                        <th scope="col">Severity</th>
                        <th scope="col">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupGates.map((gate) => (
                        <tr key={gate.id}>
                          <td>
                            <strong>{gate.title}</strong>
                            <small>{gate.reason}</small>
                            <small>{gate.freshness}</small>
                            <TechnicalEvidence
                              identifiers={[
                                { label: "Gate key", value: gate.id },
                                ...(gate.technicalEvidence
                                  ? [
                                      {
                                        label: "Activation evidence",
                                        value: gate.technicalEvidence,
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </td>
                          <td>{gate.owner}</td>
                          <td>{gate.capability}</td>
                          <td>{gate.activationTest}</td>
                          <td>
                            <StatusPill state={gate.severity} />
                          </td>
                          <td>
                            <StatusPill state={gate.state} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.empty}>
                  No {group.toLowerCase()} gates are registered.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </AdministrationPage>
  );
}
