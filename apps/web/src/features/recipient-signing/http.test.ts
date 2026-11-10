/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect mocks, not unbound calls. */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { SigningRecipient } from "@clockwork/contracts";
import type { SigningJourneyStore } from "@clockwork/db";
import { recipientAccessToken } from "@clockwork/integrations";
import { recipientSigningHandler } from "./http";
function setup() {
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
  const store: SigningJourneyStore = {
    recipient: vi.fn().mockResolvedValue(recipient),
    reserveProviderRead: vi.fn().mockResolvedValue(true),
    recordAccess: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    synchronize: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(null),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  const view = {
    title: "NDA",
    recipientName: "Alex",
    state: "ready",
    testMode: true,
    canDownload: false,
  };
  const service = {
    sourceFor: vi.fn().mockResolvedValue({}),
    view: vi.fn().mockResolvedValue(view),
    launch: vi.fn().mockResolvedValue("https://www.signwell.com/docs/alex/"),
    refresh: vi.fn().mockResolvedValue(view),
    download: vi.fn().mockResolvedValue(Buffer.from("%PDF-executed")),
  };
  const origin = "https://commerce.example.test",
    secret = "recipient-http-test-secret-at-least-32-characters";
  const handler = recipientSigningHandler({
    store,
    service,
    origin,
    secret,
    secure: true,
  });
  const token = recipientAccessToken(
    recipient,
    secret,
    Math.floor(Date.now() / 1000) + 60,
  );
  const request = (action: string, init?: RequestInit) =>
    new Request(`${origin}/sign/${recipient.id}/${action}`, init);
  const cookie = `cw_sign_${recipient.id.replaceAll("-", "")}=${token}`;
  return { recipient, store, service, handler, token, origin, request, cookie };
}
it("exchanges a private link into a scoped HttpOnly session without returning credentials", async () => {
  const s = setup();
  const response = await s.handler(
    s.request("access", {
      method: "POST",
      headers: { origin: s.origin },
      body: s.token,
    }),
    s.recipient.id,
    "access",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain(
    `Path=/sign/${s.recipient.id}; HttpOnly; SameSite=Strict;`,
  );
  expect(response.headers.get("set-cookie")).toContain("Secure");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const body = await response.text();
  expect(body).not.toContain(s.token);
  expect(body).not.toContain(s.recipient.email);
  expect(body).not.toContain("signwell");
});
it("does not expose status, provider URL or PDF without the matching capability", async () => {
  const s = setup();
  for (const action of ["status", "file", "launch"]) {
    const response = await s.handler(
      s.request(action, {
        method: action === "launch" ? "POST" : "GET",
        headers: { origin: s.origin },
      }),
      s.recipient.id,
      action,
    );
    expect(response.status).toBe(401);
  }
  expect(s.service.view).not.toHaveBeenCalled();
  expect(s.service.launch).not.toHaveBeenCalled();
  expect(s.service.download).not.toHaveBeenCalled();
});
it("refuses cross-origin writes, oversized tokens and revoked sessions", async () => {
  const s = setup();
  expect(
    (
      await s.handler(
        s.request("launch", {
          method: "POST",
          headers: { cookie: s.cookie, origin: "https://evil.example.test" },
        }),
        s.recipient.id,
        "launch",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await s.handler(
        s.request("access", {
          method: "POST",
          headers: { origin: s.origin },
          body: "x".repeat(257),
        }),
        s.recipient.id,
        "access",
      )
    ).status,
  ).toBe(401);
  s.recipient.revoked = true;
  expect(
    (
      await s.handler(
        s.request("file", { headers: { cookie: s.cookie } }),
        s.recipient.id,
        "file",
      )
    ).status,
  ).toBe(401);
});
it("throttles live reads but lets cached status and archive downloads work", async () => {
  const s = setup();
  vi.mocked(s.store.reserveProviderRead).mockResolvedValue(false);
  const response = await s.handler(
    s.request("refresh", {
      method: "POST",
      headers: { cookie: s.cookie, origin: s.origin },
    }),
    s.recipient.id,
    "refresh",
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("10");
  expect(s.service.refresh).not.toHaveBeenCalled();
  expect(
    (
      await s.handler(
        s.request("status", { headers: { cookie: s.cookie } }),
        s.recipient.id,
        "status",
      )
    ).status,
  ).toBe(200);
  const file = await s.handler(
    s.request("file", { headers: { cookie: s.cookie } }),
    s.recipient.id,
    "file",
  );
  expect(file.headers.get("cache-control")).toContain("no-store");
  expect(await file.text()).toBe("%PDF-executed");
});
