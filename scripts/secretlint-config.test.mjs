import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function lint(input) {
  return spawnSync(
    "pnpm",
    ["exec", "secretlint", "--stdinFileName=netlify-token-fixture.txt"],
    { cwd: process.cwd(), encoding: "utf8", input },
  );
}

test("secretlint rejects a Netlify access token assignment", () => {
  const assignment = `${"NETLIFY_AUTH_"}TOKEN=${"a".repeat(40)}`;
  const result = lint(assignment);
  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /@secretlint\/secretlint-rule-pattern/,
  );
});

test("secretlint rejects a Netlify personal access token outside an assignment", () => {
  const command = `netlify deploy --auth ${"nfp_"}${"a".repeat(40)}`;
  const result = lint(command);
  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /@secretlint\/secretlint-rule-pattern/,
  );
});

test("secretlint permits the documented environment placeholder", () => {
  const assignment = `${"NETLIFY_AUTH_"}TOKEN="${"${NETLIFY_AUTH_TOKEN:?set NETLIFY_AUTH_TOKEN}"}"`;
  const result = lint(assignment);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
