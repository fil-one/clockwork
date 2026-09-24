import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { locales } from "@/src/i18n/locales";
import { translatorFor } from "@/src/i18n/catalogs";

import {
  alertPreferenceRows,
  manageableAlerts,
  notificationChannel,
  refusedAlerts,
  suppressedAlertCount,
} from "./notification-preference-model";

const migrations = path.resolve(
  import.meta.dirname,
  "../../../../../../../supabase/migrations",
);

function checkedValues(file: string, column: string): string[] {
  const sql = readFileSync(path.join(migrations, file), "utf8");
  const match = new RegExp(
    `${column} text not null check \\(${column} in \\(([^)]*)\\)\\)`,
    "u",
  ).exec(sql);
  if (!match?.[1])
    throw new Error(`No ${column} check constraint found in ${file}`);
  return [...match[1].matchAll(/'([^']+)'/gu)].map((value) => value[1] ?? "");
}

/**
 * The two lists in the model are a copy of a database vocabulary, and a copy
 * that nothing compares is a copy that drifts. These read the migrations that
 * own the constraint and fail the moment either stops agreeing.
 */
describe("the vocabulary this surface offers is the one the database enforces", () => {
  it("offers exactly the alert kinds notification_preferences accepts", () => {
    expect(manageableAlerts.map((alert) => alert.kind)).toEqual(
      checkedValues("001400_notification_preferences.sql", "alert_kind"),
    );
  });

  it("names exactly the alert kinds the preference constraint leaves out", () => {
    const delivered = checkedValues(
      "001330_notification_deliveries.sql",
      "alert_kind",
    );
    const manageable = new Set(manageableAlerts.map((alert) => alert.kind));
    expect(refusedAlerts.map((alert) => alert.kind)).toEqual(
      delivered.filter((kind) => !manageable.has(kind)),
    );
  });

  it("uses the only channel the preference constraint accepts", () => {
    expect(
      checkedValues("001400_notification_preferences.sql", "channel"),
    ).toEqual([notificationChannel]);
  });

  it("states a reason for every alert it refuses to switch off, in every language", () => {
    for (const locale of locales) {
      const t = translatorFor(locale);
      for (const alert of refusedAlerts) {
        expect(t(alert.reason).length, locale).toBeGreaterThan(10);
        expect(t(alert.reason), locale).not.toBe(alert.reason);
        expect(t(alert.label), locale).not.toBe(alert.kind);
      }
    }
  });
});

describe("what an account is shown before it has stored anything", () => {
  it("treats an absent row as on, because the migration does", () => {
    const rows = alertPreferenceRows([]);
    expect(rows).toHaveLength(manageableAlerts.length);
    expect(rows.every((row) => row.enabled && row.isDefault)).toBe(true);
    expect(suppressedAlertCount(rows)).toBe(0);
  });

  it("reports a stored suppression as stored, not as a default", () => {
    const rows = alertPreferenceRows([
      { alertKind: "quote_expiry", channel: "email", enabled: false },
    ]);
    const quoteExpiry = rows.find((row) => row.kind === "quote_expiry");
    expect(quoteExpiry).toMatchObject({ enabled: false, isDefault: false });
    expect(suppressedAlertCount(rows)).toBe(1);
    expect(
      rows
        .filter((row) => row.kind !== "quote_expiry")
        .every((row) => row.enabled),
    ).toBe(true);
  });

  it("ignores a stored row for another channel", () => {
    const rows = alertPreferenceRows([
      { alertKind: "quote_expiry", channel: "sms", enabled: false },
    ]);
    expect(rows.find((row) => row.kind === "quote_expiry")).toMatchObject({
      enabled: true,
      isDefault: true,
    });
  });

  it("offers no control for an alert the database would refuse", () => {
    const offered = new Set(alertPreferenceRows([]).map((row) => row.kind));
    for (const alert of refusedAlerts)
      expect(offered.has(alert.kind)).toBe(false);
  });
});
