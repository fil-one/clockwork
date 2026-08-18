import assert from "node:assert/strict";
import test from "node:test";

import { assertDatabaseTestResults } from "./run-db-tests.mjs";

test("the database gate rejects Supabase's successful zero-test result", () => {
  assert.throws(
    () =>
      assertDatabaseTestResults(
        "Files=0, Tests=0, 0 wallclock secs\nResult: NOTESTS",
      ),
    /executed zero pgTAP tests/,
  );
});

test("the database gate accepts a non-empty pgTAP summary", () => {
  assert.doesNotThrow(() =>
    assertDatabaseTestResults(
      "Files=47, Tests=675, 10 wallclock secs\nResult: PASS",
    ),
  );
});

test("the database gate requires a pgTAP summary", () => {
  assert.throws(
    () => assertDatabaseTestResults("Command completed successfully"),
    /executed zero pgTAP tests/,
  );
});
