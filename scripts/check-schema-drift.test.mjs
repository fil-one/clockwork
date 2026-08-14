import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COVERAGE,
  UNMIRRORED_TABLES,
  compareSchemaShape,
} from "./check-schema-drift.mjs";

// Fixtures, not a live database: the comparison is the part that can be wrong in
// a way nobody notices, and it has to be testable without Supabase running.
const table = (name, columns) => ({
  name,
  columns: Object.entries(columns).map(([column, notNull]) => ({
    name: column,
    notNull,
  })),
});
const correlations = (accountIdNotNull) =>
  table("experience_esign_return_correlations", {
    id: true,
    account_id: accountIdNotNull,
  });
const noExceptions = Object.freeze({});
const ids = (report) => report.failures.map((failure) => failure.id);

test("a faithful mirror reports no drift", () => {
  const report = compareSchemaShape({
    modelTables: [correlations(true)],
    databaseTables: [correlations(true)],
    unmirroredTables: noExceptions,
  });
  assert.deepEqual(report.failures, []);
  assert.equal(report.modelTables, 1);
  assert.equal(report.databaseTables, 1);
  assert.equal(report.modelColumns, 2);
  assert.deepEqual(report.unmirroredTables, []);
});

test("a column modelled nullable against a not null column is drift", () => {
  const report = compareSchemaShape({
    modelTables: [correlations(false)],
    databaseTables: [correlations(true)],
    unmirroredTables: noExceptions,
  });
  assert.deepEqual(ids(report), [
    "SCHEMA_DRIFT_NULLABILITY:experience_esign_return_correlations.account_id",
  ]);
  assert.match(report.failures[0].detail, /model says nullable/);
  assert.match(report.failures[0].detail, /applied schema says not null/);
});

test("drift is reported in the other direction too", () => {
  const report = compareSchemaShape({
    modelTables: [correlations(true)],
    databaseTables: [correlations(false)],
    unmirroredTables: noExceptions,
  });
  assert.deepEqual(ids(report), [
    "SCHEMA_DRIFT_NULLABILITY:experience_esign_return_correlations.account_id",
  ]);
});

test("a modelled table the applied schema does not have is drift", () => {
  const report = compareSchemaShape({
    modelTables: [table("invented", { id: true })],
    databaseTables: [],
    unmirroredTables: noExceptions,
  });
  assert.deepEqual(ids(report), ["SCHEMA_DRIFT_TABLE_MISSING:invented"]);
});

test("column presence is compared in both directions", () => {
  const report = compareSchemaShape({
    modelTables: [table("orders", { id: true, stale_column: false })],
    databaseTables: [table("orders", { id: true, new_column: false })],
    unmirroredTables: noExceptions,
  });
  assert.deepEqual(ids(report), [
    "SCHEMA_DRIFT_COLUMN_MISSING:orders.stale_column",
    "SCHEMA_DRIFT_COLUMN_UNMODELLED:orders.new_column",
  ]);
});

test("an unmodelled table fails unless it is a recorded exception", () => {
  const databaseTables = [
    table("core_order_acceptance_reservations", { order_id: true }),
  ];
  const unrecorded = compareSchemaShape({
    modelTables: [],
    databaseTables,
    unmirroredTables: noExceptions,
  });
  assert.deepEqual(ids(unrecorded), [
    "SCHEMA_DRIFT_TABLE_UNMODELLED:core_order_acceptance_reservations",
  ]);

  const recorded = compareSchemaShape({
    modelTables: [],
    databaseTables,
    unmirroredTables: UNMIRRORED_TABLES,
  });
  assert.deepEqual(recorded.failures, []);
  assert.deepEqual(recorded.unmirroredTables, [
    "core_order_acceptance_reservations",
  ]);
});

test("a recorded exception that no longer applies fails as stale", () => {
  const modelled = compareSchemaShape({
    modelTables: [
      table("core_order_acceptance_reservations", { order_id: true }),
    ],
    databaseTables: [
      table("core_order_acceptance_reservations", { order_id: true }),
    ],
    unmirroredTables: UNMIRRORED_TABLES,
  });
  assert.deepEqual(ids(modelled), [
    "SCHEMA_DRIFT_UNMIRRORED_STALE:core_order_acceptance_reservations",
  ]);

  const dropped = compareSchemaShape({
    modelTables: [],
    databaseTables: [],
    unmirroredTables: UNMIRRORED_TABLES,
  });
  assert.deepEqual(ids(dropped), [
    "SCHEMA_DRIFT_UNMIRRORED_STALE:core_order_acceptance_reservations",
  ]);
});

test("every recorded exception carries a reason", () => {
  for (const [name, reason] of Object.entries(UNMIRRORED_TABLES))
    assert.ok(reason.length > 40, `${name} needs a written reason`);
});

// The checker's usefulness depends on it never overstating itself: index sort
// direction is the second recorded ADR-0003 drift and this tool does not catch
// it, so the disclaimer is held in place by a test rather than by good intentions.
test("the stated coverage keeps disclaiming what it cannot see", () => {
  assert.ok(COVERAGE.covers.some((entry) => entry.includes("nullability")));
  const disclaimed = COVERAGE.doesNotCover.join("\n");
  assert.match(disclaimed, /indexes/);
  assert.match(disclaimed, /sort direction/);
  assert.match(disclaimed, /check constraints/);
  assert.match(disclaimed, /default/);
});
