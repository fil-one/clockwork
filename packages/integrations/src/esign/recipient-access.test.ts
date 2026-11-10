import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { SigningRecipient } from "@clockwork/contracts";
import {
  recipientAccessToken,
  verifyRecipientAccess,
  signWellRecipientUrl,
} from "./recipient-access";
const secret = "test-signing-link-secret-at-least-32-characters";
const now = 1_800_000_000_000;
const recipient: SigningRecipient = {
  id: randomUUID(),
  nonce: randomUUID(),
  kind: "mnda",
  requestId: randomUUID(),
  providerId: randomUUID(),
  slot: "counterparty",
  name: "Alex",
  email: "alex@example.test",
  title: "NDA",
  testMode: true,
  signed: false,
  nextToSign: true,
  revoked: false,
};
it("binds private links to one recipient, revocation epoch and expiry", () => {
  const expiry = now / 1000 + 60;
  const token = recipientAccessToken(recipient, secret, expiry);
  expect(verifyRecipientAccess(recipient, token, secret, now)).toBe(expiry);
  expect(
    verifyRecipientAccess(
      { ...recipient, id: randomUUID() },
      token,
      secret,
      now,
    ),
  ).toBeNull();
  expect(
    verifyRecipientAccess(
      { ...recipient, nonce: randomUUID() },
      token,
      secret,
      now,
    ),
  ).toBeNull();
  expect(
    verifyRecipientAccess({ ...recipient, revoked: true }, token, secret, now),
  ).toBeNull();
  expect(
    verifyRecipientAccess(recipient, token, secret, now + 60_000),
  ).toBeNull();
  expect(
    verifyRecipientAccess(
      recipient,
      token.replace(String(expiry), String(expiry + 1)),
      secret,
      now,
    ),
  ).toBeNull();
  expect(
    verifyRecipientAccess(
      recipient,
      recipientAccessToken(recipient, secret, now / 1000 + 8 * 86400),
      secret,
      now,
    ),
  ).toBeNull();
});
it.each([
  "https://www.signwell.com.evil.test/docs/abc",
  "http://www.signwell.com/docs/abc",
  "https://www.signwell.com/api/v1/documents",
  "javascript:alert(1)",
  "https://user@www.signwell.com/docs/abc",
  "https://www.signwell.com/docs/abc#secret",
])("refuses an unsafe signing frame: %s", (value) => {
  expect(() => signWellRecipientUrl(value)).toThrow();
});
it("accepts a documented SignWell recipient URL", () =>
  expect(
    signWellRecipientUrl(
      "https://www.signwell.com/docs/abc-123/?embedded=true",
    ),
  ).toContain("/docs/abc-123/"));
