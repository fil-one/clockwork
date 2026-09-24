"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId, Translator } from "@/src/i18n";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import { Select, Table } from "@clockwork/ui";

import {
  ExternalGateClientError,
  runGeneratedExternalGateActivationTest,
  updateGeneratedExternalGate,
  type GeneratedExternalGate,
} from "@/src/features/contracts/external-gates-client";
import { formatSurfaceTimestamp } from "@/src/features/customer-partner/formatting";
import {
  runDemoExternalGateActivationTest,
  updateDemoExternalGate,
} from "@/src/features/internal-ops/gates/demo-gate-actions";
import type { GateRecordSource } from "@/src/features/internal-ops/gates/server-gate-loader";

import {
  adminSafetyCopy,
  gateBlockedReasonLabels,
  gateGroupCaptions,
  gateGroupLabels,
  gateSeverityLabels,
  gateStateLabels,
  gateStateTones,
  gateStatusLabels,
  gateTestStatusLabels,
} from "./copy";
import type { DemoGateText, GateGroup, GateRecord } from "./data";
import { canDecide, gateGroups, gateSeverities, gateStates } from "./policy";
import {
  AdministrationPage,
  StatusPill,
  TechnicalEvidence,
  styles,
} from "./ui";

/** Registry timestamps are shown on the operations desk's clock, labelled. */
const operationsTimeZone = "America/New_York";

const groupOrder: readonly GateGroup[] = [
  gateGroups.provider,
  gateGroups.legal,
  gateGroups.brand,
  gateGroups.operations,
];

const sourceLabels: Readonly<Record<GateRecordSource, MessageId>> = {
  "System gate registry": "adminGovernance.gates.source.system",
  "Demonstration gate registry": "adminGovernance.gates.source.demo",
  "Fail-closed operational fallback": "adminGovernance.gates.source.fallback",
};

/** The loader's stand-in row when the registry cannot be read at all. */
const unavailableRegistryId = "SYSTEM-GATE-REGISTRY-UNAVAILABLE";

function gateGroup(key: GeneratedExternalGate["gateKey"]): GateGroup {
  if (["EXT-LEGAL-01", "EXT-TAX-01"].includes(key)) return gateGroups.legal;
  if (["EXT-BRAND-01", "EXT-DOMAIN-01", "EXT-MARKETPLACE-01"].includes(key))
    return gateGroups.brand;
  if (
    [
      "EXT-COMMERCIAL-01",
      "EXT-APPROVERS-01",
      "EXT-TEARDOWN-01",
      "EXT-MIGRATION-01",
    ].includes(key)
  )
    return gateGroups.operations;
  return gateGroups.provider;
}

function severityLabel(value: string): GateRecord["severity"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("launch") || normalized.includes("country"))
    return gateSeverities.launchBlocker;
  if (normalized.includes("path") || normalized.includes("block"))
    return gateSeverities.pathBlocker;
  if (normalized.includes("medium")) return gateSeverities.medium;
  return gateSeverities.high;
}

function stateLabel(
  state: GeneratedExternalGate["effectiveStatus"],
): GateRecord["state"] {
  if (state === "active" || state === "not_required") return gateStates.active;
  if (state === "review") return gateStates.review;
  if (state === "pending") return gateStates.pending;
  return gateStates.blocked;
}

/**
 * A registry row as the register shows it. Timestamps and the test result
 * stay facts (`updatedAt`, `activationTestStatus`, `activationTestedAt`); the
 * register words them in the reader's language.
 */
export function presentGeneratedGate(
  gate: GeneratedExternalGate,
  /** The reader's formatting locale. */
  locale: string,
): GateRecord {
  return {
    id: gate.gateKey,
    group: gateGroup(gate.gateKey),
    title: gate.title,
    owner: gate.owner,
    capability: gate.affectedFeature,
    activationTest: gate.simulatorDetails,
    activationTestStatus: gate.lastActivationTestStatus,
    activationTestedAt: gate.lastActivationTestAt,
    severity: severityLabel(gate.severity),
    state: stateLabel(gate.effectiveStatus),
    freshness: formatSurfaceTimestamp(gate.updatedAt, {
      locale,
      timeZone: operationsTimeZone,
    }),
    updatedAt: gate.updatedAt,
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

/**
 * Puts a register row into the reader's language where the text is the
 * product's or the demo's own: the loader's unavailable-registry row, and
 * demo fields an operator has not overwritten (see `DemoGateText`).
 */
function localizeGate(
  gate: GateRecord,
  demoText: DemoGateText | undefined,
  t: Translator,
): GateRecord {
  if (gate.id === unavailableRegistryId)
    return {
      ...gate,
      title: t("adminGovernance.gates.unavailable.title"),
      owner: t("adminGovernance.gates.unavailable.owner"),
      capability: t("adminGovernance.gates.unavailable.capability"),
      activationTest: t("adminGovernance.gates.unavailable.activationTest"),
      freshness: t("adminGovernance.gates.unavailable.freshness"),
      reason: t("adminGovernance.gates.unavailable.reason"),
    };
  const fields = demoText?.[gate.id];
  if (!fields) return gate;
  const pick = (
    value: string,
    [english, localized]: readonly [string, string],
  ) => (value === english ? localized : value);
  return {
    ...gate,
    title: pick(gate.title, fields.title),
    owner: pick(gate.owner, fields.owner),
    capability: pick(gate.capability, fields.capability),
    activationTest: pick(gate.activationTest, fields.activationTest),
    reason: pick(gate.reason, fields.reason),
    ...(gate.inputRequired === undefined
      ? {}
      : { inputRequired: pick(gate.inputRequired, fields.reason) }),
    ...(gate.updatedAt
      ? {}
      : { freshness: t("adminGovernance.gates.freshness.fallback") }),
  };
}

function statusText(value: string | undefined, t: Translator): string {
  if (!value) return t("adminGovernance.gates.status.unknown");
  const id = gateStatusLabels[value];
  return id ? t(id) : value;
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
  const [owner, setOwner] = useState(gate.owner);
  const [inputRequired, setInputRequired] = useState(gate.inputRequired ?? "");
  const [configuredStatus, setConfiguredStatus] = useState(
    gate.configuredState ?? "blocked",
  );
  const [reviewOn, setReviewOn] = useState(gate.reviewOn ?? "");
  const [reason, setReason] = useState(gate.reason);
  const [message, setMessage] = useState<MessageId | "">("");
  const [error, setError] = useState<MessageId | "">("");
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
            ? "adminGovernance.gates.result.allowed"
            : "adminGovernance.gates.result.denied",
        );
      } catch (caught) {
        setError(
          !(caught instanceof ExternalGateClientError)
            ? "adminGovernance.gates.error.unavailable"
            : caught.status === 409
              ? "adminGovernance.gates.error.conflict"
              : caught.status === 403
                ? "adminGovernance.gates.error.authority"
                : caught.status === 422
                  ? "adminGovernance.gates.error.policyDenied"
                  : "adminGovernance.gates.error.unavailable",
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
      <summary>{t("adminGovernance.gates.controls.summary")}</summary>
      <form className={styles.panelBody} onSubmit={save}>
        <p className={styles.fieldHint}>
          {t("adminGovernance.gates.controls.hint")}
        </p>
        <label className={styles.field}>
          {t("common.owner")}
          <input
            value={owner}
            minLength={2}
            maxLength={200}
            required
            onChange={(event) => setOwner(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          {t("adminGovernance.gates.controls.inputRequired")}
          <textarea
            value={inputRequired}
            minLength={8}
            maxLength={2000}
            required
            onChange={(event) => setInputRequired(event.target.value)}
          />
        </label>
        <Select
          label={t("adminGovernance.gates.controls.configuredState")}
          value={configuredStatus}
          onChange={(event) => setConfiguredStatus(event.target.value)}
          options={[
            { value: "blocked", label: t("status.blocked") },
            { value: "review", label: t("status.inReview") },
            { value: "pending", label: t("status.pending") },
            {
              value: "active",
              label: t("adminGovernance.gates.controls.activeStillChecked"),
            },
            {
              value: "not_required",
              label: t("adminGovernance.gates.status.notRequired"),
            },
          ]}
        />
        <label className={styles.field}>
          {t("adminGovernance.gates.controls.reviewDate")}
          <input
            type="date"
            value={reviewOn}
            onChange={(event) => setReviewOn(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          {t("adminGovernance.decisionReason")}
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
            {pending
              ? t("common.saving")
              : t("adminGovernance.gates.controls.save")}
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
            {pending
              ? t("adminGovernance.gates.controls.testing")
              : t("adminGovernance.gates.controls.runTest")}
          </button>
        </div>
        {message ? (
          <p className={styles.success} role="status">
            {t(message)}
          </p>
        ) : null}
        {error ? (
          <p className={styles.danger} role="alert">
            {t(error)}
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
  demoText,
}: {
  roles: readonly string[];
  gates: readonly GateRecord[];
  source: GateRecordSource;
  /**
   * The demo fixtures' text in the reader's language. Only a page reading a
   * demo or fallback register passes it; system registry rows never get one.
   */
  demoText?: DemoGateText;
}) {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
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
  const localized = useMemo(
    () => displayGates.map((gate) => localizeGate(gate, demoText, t)),
    [demoText, displayGates, t],
  );
  const heading = adminSafetyCopy.gates;
  const reasons = new Intl.ListFormat(formattingLocale, {
    type: "conjunction",
  });
  const timestamp = (value: string) =>
    formatSurfaceTimestamp(value, {
      locale: formattingLocale,
      timeZone: operationsTimeZone,
    });

  return (
    <AdministrationPage
      eyebrow={t(heading.eyebrow)}
      title={t(heading.title)}
      description={t(heading.description)}
    >
      <section className={styles.notice} role="note">
        <strong>{t(sourceLabels[source])}</strong>
        {t("adminGovernance.gates.failClosedNotice")}
      </section>

      {!mayOperate ? (
        <section className={styles.roleNotice} role="note">
          <strong>{t("adminGovernance.gates.readOnlyTitle")}</strong>
          {t("adminGovernance.gates.readOnlyDetail")}
        </section>
      ) : null}

      <div className={styles.gateGroups}>
        {groupOrder.map((group) => {
          const groupGates = localized.filter((gate) => gate.group === group);
          const blockers = groupGates.filter(
            (gate) => gate.state === gateStates.blocked,
          ).length;
          return (
            <section
              className={styles.panel}
              key={group}
              aria-labelledby={`gate-group-${group.toLowerCase()}`}
            >
              <div className={styles.panelHeading}>
                <div>
                  <h2 id={`gate-group-${group.toLowerCase()}`}>
                    {t(gateGroupLabels[group])}
                  </h2>
                  <p>
                    {t("common.join.labels", {
                      first: t("adminGovernance.gates.count", {
                        count: groupGates.length,
                      }),
                      second: t("adminGovernance.gates.blockedCount", {
                        count: blockers,
                      }),
                    })}
                  </p>
                </div>
                <StatusPill
                  state={
                    blockers
                      ? t("adminGovernance.gates.blockers", {
                          count: blockers,
                        })
                      : t("adminGovernance.gates.noBlockers")
                  }
                  tone="warning"
                />
              </div>
              <Table
                className={styles.scanTable ?? ""}
                caption={t(gateGroupCaptions[group])}
                captionHidden
                density="compact"
                headers={[
                  t("adminGovernance.gates.column.gate"),
                  t("common.owner"),
                  t("adminGovernance.gates.column.capability"),
                  t("adminGovernance.gates.column.activationTest"),
                  t("adminGovernance.gates.column.severity"),
                  t("adminGovernance.gates.column.configuredEffective"),
                ]}
                rowKeys={groupGates.map((gate) => gate.id)}
                rows={groupGates.map((gate) => [
                  <div className={styles.stackCell}>
                    <strong>{gate.title}</strong>
                    <small>{gate.reason}</small>
                    <small>
                      {gate.updatedAt
                        ? t("common.updatedAt", {
                            time: timestamp(gate.updatedAt),
                          })
                        : gate.freshness}
                    </small>
                    <TechnicalEvidence
                      identifiers={[
                        {
                          label: t("adminGovernance.identifier.gateKey"),
                          value: gate.id,
                        },
                        ...(gate.technicalEvidence
                          ? [
                              {
                                label: t(
                                  "adminGovernance.identifier.activationEvidence",
                                ),
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
                  gate.activationTestStatus ? (
                    <span className={styles.stackCell}>
                      <span>
                        {gate.activationTestStatus !== "never" &&
                        gate.activationTestedAt
                          ? t("common.join.labels", {
                              first: t(
                                gateTestStatusLabels[gate.activationTestStatus],
                              ),
                              second: timestamp(gate.activationTestedAt),
                            })
                          : t(gateTestStatusLabels[gate.activationTestStatus])}
                      </span>
                      <small>{gate.activationTest}</small>
                    </span>
                  ) : (
                    gate.activationTest
                  ),
                  <StatusPill
                    state={t(gateSeverityLabels[gate.severity])}
                    tone="warning"
                  />,
                  <div className={styles.stackCell}>
                    <small>
                      {t("adminGovernance.gates.configured", {
                        state: statusText(gate.configuredState, t),
                      })}
                    </small>
                    <StatusPill
                      state={t(gateStateLabels[gate.state])}
                      tone={gateStateTones[gate.state]}
                    />
                    <small>
                      {t("adminGovernance.gates.effective", {
                        state: gate.effectiveState
                          ? statusText(gate.effectiveState, t)
                          : t(gateStateLabels[gate.state]),
                      })}
                    </small>
                    <strong>
                      {t(
                        gate.activationAllowed
                          ? "adminGovernance.gates.activationAllowed"
                          : "adminGovernance.gates.activationDenied",
                      )}
                    </strong>
                    {gate.blockedReasons?.length ? (
                      <small>
                        {t("adminGovernance.gates.blockedReasons", {
                          reasons: reasons.format(
                            gate.blockedReasons.map((code) => {
                              const id = gateBlockedReasonLabels[code];
                              return id ? t(id) : code;
                            }),
                          ),
                        })}
                      </small>
                    ) : null}
                  </div>,
                ])}
                emptyState={t("adminGovernance.gates.empty")}
              />
            </section>
          );
        })}
      </div>
    </AdministrationPage>
  );
}
