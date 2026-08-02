"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";

import {
  ExternalGateClientError,
  runGeneratedExternalGateActivationTest,
  updateGeneratedExternalGate,
  type GeneratedExternalGate,
} from "@/src/features/contracts/external-gates-client";

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
  if (["EXT-BRAND-01", "EXT-DOMAIN-01", "EXT-MARKETPLACE-01"].includes(key))
    return "Brand";
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
    configuredState: gate.configuredStatus,
    effectiveState: gate.effectiveStatus,
    activationAllowed: gate.activationAllowed,
    blockedReasons: gate.blockedReasons,
    inputRequired: gate.inputRequired,
    reviewOn: gate.reviewOn,
    rowVersion: gate.rowVersion,
    ...(gate.activationEvidenceReference
      ? { technicalEvidence: gate.activationEvidenceReference }
      : {}),
  };
}

function GateControls({
  gate,
  onUpdated,
}: {
  gate: GateRecord;
  onUpdated: (gate: GeneratedExternalGate) => void;
}) {
  const [owner, setOwner] = useState(gate.owner);
  const [inputRequired, setInputRequired] = useState(gate.inputRequired ?? "");
  const [configuredStatus, setConfiguredStatus] = useState(
    gate.configuredState ?? "blocked",
  );
  const [reviewOn, setReviewOn] = useState(gate.reviewOn ?? "");
  const [reason, setReason] = useState(gate.reason);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const operate = (operation: () => Promise<GeneratedExternalGate>) => {
    setMessage("");
    setError("");
    startTransition(async () => {
      try {
        const updated = await operation();
        onUpdated(updated);
        setMessage(
          updated.activationAllowed
            ? "Server policy allows activation."
            : "Saved. Activation remains denied by server policy.",
        );
      } catch (caught) {
        setError(
          caught instanceof ExternalGateClientError
            ? caught.message
            : "The gate operation is unavailable. Nothing was changed.",
        );
      }
    });
  };

  /** A gate read from the fail-closed fallback carries no writable version. */
  const requireRowVersion = () => {
    if (gate.rowVersion) return true;
    setMessage("");
    setError(adminSafetyCopy.gateVersionUnavailable);
    return false;
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireRowVersion()) return;
    operate(() =>
      updateGeneratedExternalGate(gate.id as GeneratedExternalGate["gateKey"], {
        expectedRowVersion: gate.rowVersion as number,
        owner,
        inputRequired,
        configuredStatus:
          configuredStatus as GeneratedExternalGate["configuredStatus"],
        reviewOn: reviewOn || null,
        statusReason: reason,
      }),
    );
  };

  return (
    <details>
      <summary>Update or test gate</summary>
      <form className={styles.panelBody} onSubmit={save}>
        <p className={styles.fieldHint}>
          Both operations require recent authentication. A configured active
          value never bypasses the server&apos;s test, evidence, owner, and
          review checks.
        </p>
        <label className={styles.field}>
          Owner
          <input
            value={owner}
            minLength={2}
            maxLength={200}
            required
            onChange={(event) => setOwner(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Required activation input or evidence
          <textarea
            value={inputRequired}
            minLength={8}
            maxLength={2000}
            required
            onChange={(event) => setInputRequired(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Configured state
          <select
            value={configuredStatus}
            onChange={(event) => setConfiguredStatus(event.target.value)}
          >
            <option value="blocked">Blocked</option>
            <option value="review">Review</option>
            <option value="pending">Pending</option>
            <option value="active">Active (still policy checked)</option>
            <option value="not_required">Not required</option>
          </select>
        </label>
        <label className={styles.field}>
          Review date
          <input
            type="date"
            value={reviewOn}
            onChange={(event) => setReviewOn(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Decision reason
          <textarea
            value={reason}
            minLength={8}
            maxLength={2000}
            required
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className={styles.inlineActions}>
          <button className={styles.buttonSecondary} disabled={pending}>
            {pending ? "Saving…" : "Save configured state"}
          </button>
          <button
            className={styles.button}
            disabled={pending}
            type="button"
            onClick={() => {
              if (!requireRowVersion()) return;
              operate(() =>
                runGeneratedExternalGateActivationTest(
                  gate.id as GeneratedExternalGate["gateKey"],
                  gate.rowVersion as number,
                ),
              );
            }}
          >
            {pending ? "Testing…" : "Run server activation test"}
          </button>
        </div>
        {message ? (
          <p className={styles.success} role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className={styles.danger} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
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
  const [displayGates, setDisplayGates] = useState(gates);
  useEffect(() => setDisplayGates(gates), [gates]);
  const updateGate = (updated: GeneratedExternalGate) =>
    setDisplayGates((current) =>
      current.map((gate) =>
        gate.id === updated.gateKey ? presentGeneratedGate(updated) : gate,
      ),
    );
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
          const groupGates = displayGates.filter(
            (gate) => gate.group === group,
          );
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
                        <th scope="col">Configured / effective</th>
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
                            {mayOperate &&
                            source === "System gate registry" &&
                            gate.rowVersion ? (
                              <GateControls
                                key={`${gate.id}:${gate.rowVersion}`}
                                gate={gate}
                                onUpdated={updateGate}
                              />
                            ) : null}
                          </td>
                          <td>{gate.owner}</td>
                          <td>{gate.capability}</td>
                          <td>{gate.activationTest}</td>
                          <td>
                            <StatusPill state={gate.severity} />
                          </td>
                          <td>
                            <div>
                              <small>
                                Configured: {gate.configuredState ?? "unknown"}
                              </small>
                              <StatusPill state={gate.state} />
                              <small>
                                Effective: {gate.effectiveState ?? gate.state}
                              </small>
                              <strong>
                                {gate.activationAllowed
                                  ? "Activation allowed"
                                  : "Activation denied"}
                              </strong>
                              {gate.blockedReasons?.length ? (
                                <small>
                                  Blockers: {gate.blockedReasons.join(", ")}
                                </small>
                              ) : null}
                            </div>
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
