import { beforeEach, expect, it, vi } from "vitest";
import { prepareMfaProof, readMfaProof } from "./prepared-challenge";
const now = 1_800_000_000_000;
const binding = {
  sessionId: "session",
  workosUserId: "user_owner",
  workosOrganizationId: "org_owner",
};
const input = { ...binding, challengeId: "challenge", factorId: "factor" };
beforeEach(() => {
  vi.stubEnv(
    "WORKOS_COOKIE_PASSWORD",
    "test-cookie-key-with-at-least-32-bytes",
  );
});
it("binds only challenge identifiers and never grants verification itself", () => {
  const prepared = prepareMfaProof(input, now);
  expect(prepared.validForMs).toBe(300_000);
  expect(readMfaProof(prepared.proof, binding, now + 1)).toMatchObject(input);
  expect(
    Object.keys(
      JSON.parse(
        Buffer.from(prepared.proof.split(".")[0] ?? "", "base64url").toString(),
      ) as Record<string, unknown>,
    ),
  ).toEqual([
    "version",
    "challengeId",
    "factorId",
    "workosUserId",
    "workosOrganizationId",
    "sessionId",
    "issuedAt",
    "expiresAt",
  ]);
});
it.each(["sessionId", "workosUserId", "workosOrganizationId"] as const)(
  "refuses another %s",
  (field) => {
    expect(() =>
      readMfaProof(
        prepareMfaProof(input, now).proof,
        { ...binding, [field]: "other" },
        now,
      ),
    ).toThrow();
  },
);
it.each([
  "version",
  "challengeId",
  "factorId",
  "workosUserId",
  "workosOrganizationId",
  "sessionId",
  "issuedAt",
  "expiresAt",
])("refuses tampered %s", (field) => {
  const [encoded, signature] = prepareMfaProof(input, now).proof.split(".");
  const payload = JSON.parse(
    Buffer.from(encoded ?? "", "base64url").toString(),
  ) as Record<string, unknown>;
  payload[field] =
    typeof payload[field] === "number" ? payload[field] + 1 : "other";
  expect(() =>
    readMfaProof(
      `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`,
      binding,
      now,
    ),
  ).toThrow();
});
it.each([-1, 300_000, 900_000])(
  "refuses a future or expired proof at offset %s",
  (offset) => {
    expect(() =>
      readMfaProof(prepareMfaProof(input, now).proof, binding, now + offset),
    ).toThrow();
  },
);
it("honors the earlier provider expiry", () => {
  const prepared = prepareMfaProof(
    { ...input, providerExpiresAt: new Date(now + 10_000).toISOString() },
    now,
  );
  expect(prepared.validForMs).toBe(10_000);
  expect(() => readMfaProof(prepared.proof, binding, now + 10_000)).toThrow();
});
it.each(["", "bad", new Date(now).toISOString()])(
  "refuses invalid or elapsed provider expiry %s",
  (providerExpiresAt) => {
    expect(() =>
      prepareMfaProof({ ...input, providerExpiresAt }, now),
    ).toThrow();
  },
);
it("refuses weak keys and key rotation", () => {
  const proof = prepareMfaProof(input, now).proof;
  vi.stubEnv(
    "WORKOS_COOKIE_PASSWORD",
    "another-cookie-key-with-at-least-32-bytes",
  );
  expect(() => readMfaProof(proof, binding, now)).toThrow();
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", "short");
  expect(() => prepareMfaProof(input, now)).toThrow();
});
it.each(["", "bad", "a.b.c", "a".repeat(2401)])(
  "refuses malformed proof",
  (proof) => {
    expect(() => readMfaProof(proof, binding, now)).toThrow();
  },
);
