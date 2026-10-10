import { describe, expect, it, vi } from "vitest";

import {
  SesStaffEmailAdapter,
  SlackWebhookAdapter,
  staffNotificationChannels,
} from "./index";

// Assembled, so the secret scanner does not read a fixture as a credential.
const webhook = [
  "https://hooks.slack.com",
  "services",
  "TEST",
  "TEST",
  "test",
].join("/");

describe("staff notification channels", () => {
  it("are off with no configuration", () => {
    const channels = staffNotificationChannels({});
    expect(channels.email).toEqual({
      configured: false,
      reason: "not_configured",
    });
    expect(channels.slack).toEqual({
      configured: false,
      reason: "not_configured",
    });
  });

  it("never send in the demo, whatever is configured", () => {
    const channels = staffNotificationChannels({
      CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER: "ses",
      COMMERCE_NOTIFICATIONS_EMAIL_FROM: "Commerce <n@fil.one>",
      COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL: webhook,
    });
    expect(channels.email).toEqual({ configured: false, reason: "demo" });
    expect(channels.slack).toEqual({ configured: false, reason: "demo" });
  });

  it("report a setting that cannot be used", () => {
    const channels = staffNotificationChannels({
      COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER: "ses",
      COMMERCE_NOTIFICATIONS_EMAIL_FROM: "not an address",
      COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL: "https://example.test/hook",
    });
    expect(channels.email).toMatchObject({
      configured: false,
      reason: "invalid_configuration",
    });
    expect(channels.slack).toMatchObject({
      configured: false,
      reason: "invalid_configuration",
    });
  });

  it("connect SES and Slack when both are configured", () => {
    const createSes = vi.fn(() => ({ send: vi.fn() }));
    const channels = staffNotificationChannels(
      {
        AWS_REGION: "us-east-2",
        COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER: "ses",
        COMMERCE_NOTIFICATIONS_EMAIL_FROM:
          "Fil One Commerce <notifications@clockwork.fil.one>",
        COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL: webhook,
      },
      { createSes },
    );
    expect(createSes).toHaveBeenCalledWith("us-east-2");
    expect(channels.email).toMatchObject({
      configured: true,
      target: "notifications@clockwork.fil.one",
    });
    // The webhook path is the secret; only the host is ever shown.
    expect(channels.slack).toMatchObject({
      configured: true,
      target: "hooks.slack.com",
    });
  });
});

describe("SES email adapter", () => {
  const message = {
    to: "a@fil.one",
    subject: "S",
    text: "T",
    html: "<p>T</p>",
  };

  it("sends from the configured sender", async () => {
    const send = vi.fn(() => Promise.resolve({ MessageId: "m-1" }));
    const adapter = new SesStaffEmailAdapter({ send }, "C <n@fil.one>");
    await expect(adapter.send(message)).resolves.toEqual({
      ok: true,
      messageId: "m-1",
    });
    const command = (send.mock.calls[0] as unknown[])[0] as {
      input: {
        FromEmailAddress: string;
        Destination: { ToAddresses: string[] };
      };
    };
    expect(command.input.FromEmailAddress).toBe("C <n@fil.one>");
    expect(command.input.Destination.ToAddresses).toEqual(["a@fil.one"]);
  });

  it("treats a refusal as permanent and an outage as transient", async () => {
    const refused = Object.assign(new Error("Email address is not verified"), {
      name: "MessageRejected",
      $metadata: { httpStatusCode: 400 },
    });
    const throttled = Object.assign(new Error("Rate exceeded"), {
      name: "TooManyRequestsException",
      $metadata: { httpStatusCode: 429 },
    });
    const adapter = (error: Error) =>
      new SesStaffEmailAdapter(
        { send: () => Promise.reject(error) },
        "n@fil.one",
      );
    await expect(adapter(refused).send(message)).resolves.toMatchObject({
      ok: false,
      kind: "permanent",
      code: "SES_MessageRejected",
    });
    await expect(adapter(throttled).send(message)).resolves.toMatchObject({
      ok: false,
      kind: "transient",
    });
    await expect(
      adapter(new Error("socket hang up")).send(message),
    ).resolves.toMatchObject({ ok: false, kind: "transient" });
    // The daily quota resets; the deployment's own credentials do not.
    const quota = Object.assign(new Error("Daily quota"), {
      name: "LimitExceededException",
      $metadata: { httpStatusCode: 400 },
    });
    const credentials = Object.assign(new Error("Could not load credentials"), {
      name: "CredentialsProviderError",
    });
    await expect(adapter(quota).send(message)).resolves.toMatchObject({
      kind: "transient",
    });
    await expect(adapter(credentials).send(message)).resolves.toMatchObject({
      kind: "permanent",
      code: "SES_CredentialsProviderError",
    });
  });
});

describe("Slack webhook adapter", () => {
  const url = new URL(webhook);

  it("posts the text", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("ok")));
    await expect(
      new SlackWebhookAdapter(url, fetch).post({
        text: "*MNDA fully signed*: Acme",
      }),
    ).resolves.toEqual({ ok: true, messageId: null });
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      text: "*MNDA fully signed*: Acme",
      unfurl_links: false,
    });
  });

  it("retries a 429 or 5xx and not a revoked hook", async () => {
    const answer = (status: number) =>
      new SlackWebhookAdapter(url, () =>
        Promise.resolve(new Response("x", { status })),
      ).post({
        text: "x",
      });
    await expect(answer(429)).resolves.toMatchObject({ kind: "transient" });
    await expect(answer(503)).resolves.toMatchObject({ kind: "transient" });
    await expect(answer(404)).resolves.toMatchObject({
      kind: "permanent",
      code: "SLACK_HTTP_404",
    });
  });
});
