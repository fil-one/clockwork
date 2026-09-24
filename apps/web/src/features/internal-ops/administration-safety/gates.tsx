"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { localizeCopy } from "@/src/i18n/copy";

import { useEffect, useState, useTransition, type FormEvent } from "react";

import { Select, Table } from "@clockwork/ui";

import {
  ExternalGateClientError,
  runGeneratedExternalGateActivationTest,
  updateGeneratedExternalGate,
  type GeneratedExternalGate,
} from "@/src/features/contracts/external-gates-client";
import {
  runDemoExternalGateActivationTest,
  updateDemoExternalGate,
} from "@/src/features/internal-ops/gates/demo-gate-actions";
import type { GateRecordSource } from "@/src/features/internal-ops/gates/server-gate-loader";

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

export function presentGeneratedGate(
  gate: GeneratedExternalGate,
  /** The reader's formatting locale. */
  locale: string,
): GateRecord {
  const tested = gate.lastActivationTestAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(gate.lastActivationTestAt))
    : "never";
  const updated = new Intl.DateTimeFormat(locale, {
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
  demo,
}: {
  gate: GateRecord;
  onUpdated: (gate: GeneratedExternalGate) => void;
  demo: boolean;
}) {
  const t = useTranslations();
  const localizedadminSafetyCopy = localizeCopy(adminSafetyCopy, t);
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
    setError(localizedadminSafetyCopy.gateVersionUnavailable);
    return false;
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requireRowVersion()) return;
    operate(() =>
      demo
        ? updateDemoExternalGate(gate.id as GeneratedExternalGate["gateKey"], {
            expectedRowVersion: gate.rowVersion as number,
            owner,
            inputRequired,
            configuredStatus:
              configuredStatus as GeneratedExternalGate["configuredStatus"],
            reviewOn: reviewOn || null,
            statusReason: reason,
          })
        : updateGeneratedExternalGate(
            gate.id as GeneratedExternalGate["gateKey"],
            {
              expectedRowVersion: gate.rowVersion as number,
              owner,
              inputRequired,
              configuredStatus:
                configuredStatus as GeneratedExternalGate["configuredStatus"],
              reviewOn: reviewOn || null,
              statusReason: reason,
            },
          ),
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
          {t("partner.detail.owner")}
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
        <Select
          label="Configured state"
          value={configuredStatus}
          onChange={(event) => setConfiguredStatus(event.target.value)}
          options={[
            { value: "blocked", label: "Blocked" },
            { value: "review", label: "Review" },
            { value: "pending", label: "Pending" },
            { value: "active", label: "Active (still policy checked)" },
            { value: "not_required", label: "Not required" },
          ]}
        />
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
                demo
                  ? runDemoExternalGateActivationTest(
                      gate.id as GeneratedExternalGate["gateKey"],
                      gate.rowVersion as number,
                    )
                  : runGeneratedExternalGateActivationTest(
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
  source: GateRecordSource;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
  const localizedadminSafetyCopy = localizeCopy(adminSafetyCopy, t);
  const mayOperate = canDecide(roles, "assisted");
  const [displayGates, setDisplayGates] = useState(gates);
  useEffect(() => setDisplayGates(gates), [gates]);
  const updateGate = (updated: GeneratedExternalGate) =>
    setDisplayGates((current) =>
      current.map((gate) =>
        gate.id === updated.gateKey
          ? presentGeneratedGate(updated, formattingLocale)
          : gate,
      ),
    );
  return (
    <AdministrationPage {...localizedadminSafetyCopy.gates}>
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
              <Table
                className={styles.scanTable ?? ""}
                caption={`${group} external activation gates`}
                captionHidden
                density="compact"
                headers={[
                  "Gate",
                  "Owner",
                  "Affected capability",
                  "Activation test",
                  "Severity",
                  "Configured / effective",
                ]}
                rowKeys={groupGates.map((gate) => gate.id)}
                rows={groupGates.map((gate) => [
                  <div className={styles.stackCell}>
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
                    source !== "Fail-closed operational fallback" &&
                    gate.rowVersion ? (
                      <GateControls
                        key={`${gate.id}:${gate.rowVersion}`}
                        gate={gate}
                        onUpdated={updateGate}
                        demo={source === "Demonstration gate registry"}
                      />
                    ) : null}
                  </div>,
                  gate.owner,
                  gate.capability,
                  gate.activationTest,
                  <StatusPill state={gate.severity} />,
                  <div className={styles.stackCell}>
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
                      <small>Blockers: {gate.blockedReasons.join(", ")}</small>
                    ) : null}
                  </div>,
                ])}
                emptyState={`No ${group.toLowerCase()} gates are registered.`}
              />
            </section>
          );
        })}
      </div>
    </AdministrationPage>
  );
}
