import { readFileSync } from "node:fs";

import { denialCodes, isDenialCode } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

interface RuntimeAlertData {
  externalGate: string;
  externalLiveInputs: readonly string[];
  alerts: readonly {
    id: string;
    filter: string;
    synthetic: string;
    runbook: string;
  }[];
}

interface RuntimeDashboardData {
  externalGate: string;
  requiredCorrelation: readonly string[];
  panels: readonly { id: string }[];
}

function read<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../docs/operations/${name}`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

describe("backend-neutral operations data", () => {
  it("links every synthetic failure to one unique alert and existing runbook", () => {
    const data = read<RuntimeAlertData>("runtime-alerts.json");
    expect(data.externalGate).toBe("EXT-ACC-01");
    expect(data.externalLiveInputs).toHaveLength(4);
    expect(data.alerts.map(({ synthetic }) => synthetic).sort()).toEqual([
      "auth_anomaly",
      "db_pitr",
      "dead_letter",
      "outbox_backlog",
      "provisioning",
      "queue_age",
      "reconciliation",
      "unhandled_error",
    ]);
    expect(new Set(data.alerts.map(({ id }) => id)).size).toBe(
      data.alerts.length,
    );
    for (const alert of data.alerts)
      expect(
        readFileSync(
          new URL(`../../../../${alert.runbook}`, import.meta.url),
          "utf8",
        ).length,
      ).toBeGreaterThan(100);
  });

  it("filters the auth anomaly alert on canonical denial codes only", () => {
    const data = read<RuntimeAlertData>("runtime-alerts.json");
    const alert = data.alerts.find(({ id }) => id === "runtime-auth-anomaly");
    const filtered = /error\.code in \[([^\]]+)\]/
      .exec(alert?.filter ?? "")?.[1]
      ?.split(",")
      .map((code) => code.trim());
    expect(filtered).toEqual([...denialCodes]);
    expect(filtered?.every(isDenialCode)).toBe(true);
  });

  it("defines the full correlation join and eight operational panels", () => {
    const data = read<RuntimeDashboardData>("runtime-dashboards.json");
    expect(data.externalGate).toBe("EXT-ACC-01");
    expect(data.requiredCorrelation).toEqual([
      "clockwork.request.id",
      "clockwork.workflow.id",
      "clockwork.task.id",
      "clockwork.audit.id",
      "clockwork.outbox.id",
    ]);
    expect(data.panels).toHaveLength(8);
    expect(new Set(data.panels.map(({ id }) => id)).size).toBe(8);
  });
});
