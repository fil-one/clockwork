import type { WebhookVerifier } from "@clockwork/contracts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";

import { synchronizeWorkosRoleEvent } from "./workos-role-sync";
import {
  ProviderScopedWebhookVerifier,
  StripeWebhookVerifier,
  WorkosWebhookVerifier,
} from "./webhook-verifiers";

const workosSecret = "workos_webhook_secret_fixture_310";
const encoder = new TextEncoder();

/**
 * WorkOS signs `${timestamp}.${body}` with HMAC-SHA256 and lowercase hex, and
 * its `t=` value is a millisecond epoch compared directly against `Date.now()`
 * — unlike Stripe, whose header is in seconds. Signing here rather than mocking
 * keeps these cases a genuine interoperability proof against the pinned SDK.
 */
function signWorkosWebhook(input: {
  body: string;
  /**
   * Signed verbatim, so a non-numeric value still produces the exact signature
   * the SDK recomputes — these cases are denied on shape, never on a bad HMAC.
   */
  epochMilliseconds: number | string;
  secret?: string;
  /** Rewrites the header's field list around the same genuine signature. */
  header?: (signatureHash: string) => string;
}) {
  const digest = createHmac("sha256", input.secret ?? workosSecret)
    .update(`${input.epochMilliseconds}.${input.body}`)
    .digest("hex");
  return input.header
    ? input.header(digest)
    : `t=${input.epochMilliseconds}, v1=${digest}`;
}

function workosRoleEventBody(eventId = "event_01HZCLOCKWORKFIXTURE") {
  return JSON.stringify({
    id: eventId,
    event: "organization_membership.created",
    created_at: "2026-08-01T12:00:00.000Z",
    data: {
      object: "organization_membership",
      id: "om_01HZCLOCKWORKFIXTURE",
      user_id: "user_01HZCLOCKWORKFIXTURE",
      organization_id: "org_01HZCLOCKWORKFIXTURE",
      status: "active",
      role: { slug: "member" },
      created_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-01T12:00:00.000Z",
    },
  });
}

describe("WorkOS webhook verifier", () => {
  it("verifies a genuinely signed delivery and yields an ingestible role event", async () => {
    const body = workosRoleEventBody();
    const result = await new WorkosWebhookVerifier(workosSecret).verify({
      rawBody: encoder.encode(body),
      signature: signWorkosWebhook({ body, epochMilliseconds: Date.now() }),
    });

    expect(result.eventId).toBe("event_01HZCLOCKWORKFIXTURE");
    const applied: unknown[] = [];
    await synchronizeWorkosRoleEvent(result.payload, {
      apply: (input) => {
        applied.push(input);
        return Promise.resolve();
      },
    });
    expect(applied).toEqual([
      {
        eventId: "event_01HZCLOCKWORKFIXTURE",
        action: "upsert",
        workosMembershipId: "om_01HZCLOCKWORKFIXTURE",
        workosOrganizationId: "org_01HZCLOCKWORKFIXTURE",
        workosUserId: "user_01HZCLOCKWORKFIXTURE",
        roleSlugs: ["member"],
        membershipStatus: "active",
        occurredAt: "2026-08-01T12:00:00.000Z",
      },
    ]);
  });

  it("rejects a tampered body carrying an otherwise valid signature", async () => {
    const body = workosRoleEventBody();
    const signature = signWorkosWebhook({
      body,
      epochMilliseconds: Date.now(),
    });

    await expect(
      new WorkosWebhookVerifier(workosSecret).verify({
        rawBody: encoder.encode(body.replace('"member"', '"admin"')),
        signature,
      }),
    ).rejects.toThrow();
  });

  it("rejects a delivery signed with a different secret", async () => {
    const body = workosRoleEventBody();

    await expect(
      new WorkosWebhookVerifier(workosSecret).verify({
        rawBody: encoder.encode(body),
        signature: signWorkosWebhook({
          body,
          epochMilliseconds: Date.now(),
          secret: "workos_webhook_secret_attacker_310",
        }),
      }),
    ).rejects.toThrow();
  });

  // The defect this class was written for: the SDK's tolerance is milliseconds,
  // so forwarding the caller's seconds unconverted rejected every delivery more
  // than 300ms old — which is every real delivery.
  it("accepts a delivery a second old under the default tolerance", async () => {
    const body = workosRoleEventBody();

    const result = await new WorkosWebhookVerifier(workosSecret).verify({
      rawBody: encoder.encode(body),
      signature: signWorkosWebhook({
        body,
        epochMilliseconds: Date.now() - 1_000,
      }),
    });

    expect(result.eventId).toBe("event_01HZCLOCKWORKFIXTURE");
  });

  it("treats the tolerance boundary in seconds, not milliseconds", async () => {
    const body = workosRoleEventBody();
    const verifier = new WorkosWebhookVerifier(workosSecret);
    const withAge = (ageSeconds: number) => ({
      rawBody: encoder.encode(body),
      signature: signWorkosWebhook({
        body,
        epochMilliseconds: Date.now() - ageSeconds * 1_000,
      }),
      toleranceSeconds: 300,
    });

    await expect(verifier.verify(withAge(299))).resolves.toMatchObject({
      eventId: "event_01HZCLOCKWORKFIXTURE",
    });
    await expect(verifier.verify(withAge(301))).rejects.toThrow();
  });

  it("rejects a future-dated delivery beyond the tolerance", async () => {
    const body = workosRoleEventBody();
    const verifier = new WorkosWebhookVerifier(workosSecret);

    await expect(
      verifier.verify({
        rawBody: encoder.encode(body),
        signature: signWorkosWebhook({
          body,
          epochMilliseconds: Date.now() + 299 * 1_000,
        }),
      }),
    ).resolves.toMatchObject({ eventId: "event_01HZCLOCKWORKFIXTURE" });
    await expect(
      verifier.verify({
        rawBody: encoder.encode(body),
        signature: signWorkosWebhook({
          body,
          epochMilliseconds: Date.now() + 3_600_000,
        }),
      }),
    ).rejects.toThrow("WorkOS webhook timestamp is outside tolerance");
  });

  /**
   * The bound above only ever saw numeric timestamps, which is exactly how a
   * blank `t=` survived it: `Number("")` is 0 — finite and ancient, so a future
   * bound waves it through — while the SDK's past bound is
   * `parseInt(timestamp, 10) < Date.now() - tolerance`, and `NaN < x` is false.
   * One header value skipped both bounds, so the delivery it authenticated
   * never expired. Every signature below is minted with the real secret over
   * the exact string the SDK feeds its HMAC, so only shape can deny them.
   */
  it("denies a `t=` that is blank or whitespace-only", async () => {
    const body = workosRoleEventBody();
    const verifier = new WorkosWebhookVerifier(workosSecret);

    for (const epochMilliseconds of ["", " ", "\t", "\n", "  \t "])
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: signWorkosWebhook({ body, epochMilliseconds }),
        }),
      ).rejects.toThrow("WorkOS webhook signature timestamp is malformed");
  });

  it("denies a `t=` that is not a canonical positive integer epoch", async () => {
    const body = workosRoleEventBody();
    const verifier = new WorkosWebhookVerifier(workosSecret);
    const now = Date.now();

    for (const epochMilliseconds of [
      `+${now}`, // Number() accepts a sign; an epoch never carries one.
      `-${now}`,
      "0",
      `000${now}`, // Leading zeros are a second spelling of one instant.
      `${now}.0`,
      `${now}abc`,
      "1e12", // Finite to Number(), but parseInt stops at the "e" and reads 1.
      "0x1", // parseInt(_, 10) reads 0; Number() reads 1.
      "99999999999999999999", // Beyond Number.MAX_SAFE_INTEGER.
      " 1785584400000",
      "1785584400000 ",
    ])
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: signWorkosWebhook({ body, epochMilliseconds }),
        }),
      ).rejects.toThrow("WorkOS webhook signature timestamp is malformed");
  });

  it("denies a header carrying no `t=` field, or more than one", async () => {
    const body = workosRoleEventBody();
    const verifier = new WorkosWebhookVerifier(workosSecret);
    const now = Date.now();
    // The SDK reads its two fields positionally — it splits each on "=" and
    // keeps index 1 — so it never checks that the timestamp field is named `t`,
    // and it ignores any field past the second.
    const headers = [
      (digest: string) => `x=${now}, v1=${digest}`,
      (digest: string) => `${now}=t, v1=${digest}`,
      (digest: string) => `t=${now}, v1=${digest}, t=${now - 86_400_000}`,
      (digest: string) => `t=${now - 86_400_000}, t=${now}, v1=${digest}`,
    ];

    for (const header of headers)
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: signWorkosWebhook({
            body,
            epochMilliseconds: now,
            header,
          }),
        }),
      ).rejects.toThrow("WorkOS webhook signature timestamp is malformed");
  });

  // A blank `t=` made the payload immortal, and this payload is a privilege
  // grant: it flows into synchronizeWorkosRoleEvent and upserts roleSlugs.
  it("denies a blank-`t=` replay instead of letting it stay fresh forever", async () => {
    const body = workosRoleEventBody();
    const signature = signWorkosWebhook({ body, epochMilliseconds: "" });
    const verifier = new WorkosWebhookVerifier(workosSecret);

    for (const toleranceSeconds of [300, 0])
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature,
          toleranceSeconds,
        }),
      ).rejects.toThrow("WorkOS webhook signature timestamp is malformed");
  });

  // WorkOS sends milliseconds. A second epoch is well-formed but resolves to
  // 1970, and milliseconds-as-microseconds to the year 58000; both are outside
  // the window rather than malformed, and both must still be denied.
  it("denies a `t=` in the wrong unit", async () => {
    const body = workosRoleEventBody();
    const verifier = new WorkosWebhookVerifier(workosSecret);

    for (const epochMilliseconds of [
      Math.floor(Date.now() / 1_000),
      Date.now() * 1_000,
    ])
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: signWorkosWebhook({ body, epochMilliseconds }),
        }),
      ).rejects.toThrow("WorkOS webhook timestamp is outside tolerance");
  });

  it("denies a tolerance that would disable the freshness check", async () => {
    const body = workosRoleEventBody();
    const verifier = new WorkosWebhookVerifier(workosSecret);
    const monthOld = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    const stale = {
      rawBody: encoder.encode(body),
      signature: signWorkosWebhook({ body, epochMilliseconds: monthOld }),
    };

    for (const toleranceSeconds of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
    ])
      await expect(
        verifier.verify({ ...stale, toleranceSeconds }),
      ).rejects.toThrow(
        "WorkOS webhook tolerance must be a non-negative integer",
      );
    await expect(verifier.verify(stale)).rejects.toThrow();
  });
});

const stripeSecret = "whsec_clockwork_fixture_310";

/**
 * Stripe's `t=` is a SECOND epoch, and its tolerance argument is seconds too.
 * Stripe signs `${parseInt(t, 10)}.${body}` — the parsed number, not the raw
 * header text — so signing the parse result mints the signature the SDK will
 * actually expect for a malformed field, including the literal "NaN" it derives
 * from a blank `t=`. That is what makes these cases denials on shape.
 */
function signStripeWebhook(body: string, epochSeconds: number | string) {
  const digest = createHmac("sha256", stripeSecret)
    .update(`${Number.parseInt(String(epochSeconds), 10)}.${body}`)
    .digest("hex");
  return `t=${epochSeconds},v1=${digest}`;
}

describe("Stripe webhook verifier", () => {
  const body = JSON.stringify({
    id: "evt_clockwork_fixture",
    type: "invoice.paid",
    created: 1_785_584_400,
    data: { object: { id: "in_clockwork_fixture" } },
  });

  it("verifies a genuinely signed delivery", async () => {
    const result = await new StripeWebhookVerifier(stripeSecret).verify({
      rawBody: encoder.encode(body),
      signature: signStripeWebhook(body, Math.floor(Date.now() / 1_000)),
    });

    expect(result.eventId).toBe("evt_clockwork_fixture");
  });

  // Stripe skips the freshness check entirely for a negative or infinite
  // tolerance, so an unvalidated window is a replay window without a bound.
  it("denies a tolerance that would disable the freshness check", async () => {
    const verifier = new StripeWebhookVerifier(stripeSecret);
    const monthOld = Math.floor(Date.now() / 1_000) - 30 * 24 * 60 * 60;
    const stale = {
      rawBody: encoder.encode(body),
      signature: signStripeWebhook(body, monthOld),
    };

    for (const toleranceSeconds of [
      Number.POSITIVE_INFINITY,
      Number.NaN,
      -1,
      1.5,
    ])
      await expect(
        verifier.verify({ ...stale, toleranceSeconds }),
      ).rejects.toThrow(
        "Stripe webhook tolerance must be a non-negative integer",
      );
    await expect(verifier.verify(stale)).rejects.toThrow(
      "Stripe webhook timestamp is outside tolerance",
    );
    // A zero tolerance is the strictest window a caller can ask for, and Stripe
    // does not honour it: the ESM build rewrites it to the 300-second default
    // (`tolerance || Webhook.DEFAULT_TOLERANCE`) and the CJS build skips the
    // check outright (`tolerance || 0`). Neither is what was asked for, so the
    // window is applied here instead and a zero means zero.
    await expect(
      verifier.verify({ ...stale, toleranceSeconds: 0 }),
    ).rejects.toThrow("Stripe webhook timestamp is outside tolerance");
    await expect(
      verifier.verify({
        rawBody: encoder.encode(body),
        signature: signStripeWebhook(body, Math.floor(Date.now() / 1_000) - 5),
        toleranceSeconds: 0,
      }),
    ).rejects.toThrow("Stripe webhook timestamp is outside tolerance");
  });

  // Stripe parses `t=` with parseInt and signs the RESULT, so a blank field is
  // authenticated as the string "NaN" and then compared as `NaN > tolerance`,
  // which is false — the same both-bounds-skipped hole as the WorkOS header.
  it("denies a `t=` that is blank, whitespace-only, or malformed", async () => {
    const verifier = new StripeWebhookVerifier(stripeSecret);
    const now = Math.floor(Date.now() / 1_000);

    for (const epochSeconds of [
      "",
      " ",
      "\t",
      "\n",
      `+${now}`,
      "0",
      `000${now}`,
      `${now}.9`,
      `${now}abc`,
      "1e9",
      "99999999999999999999",
    ])
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: signStripeWebhook(body, epochSeconds),
        }),
      ).rejects.toThrow("Stripe webhook signature timestamp is malformed");
  });

  it("denies a header carrying no `t=` field, or more than one", async () => {
    const verifier = new StripeWebhookVerifier(stripeSecret);
    const now = Math.floor(Date.now() / 1_000);
    const digest = createHmac("sha256", stripeSecret)
      .update(`${now}.${body}`)
      .digest("hex");

    for (const signature of [
      `v1=${digest}`,
      `t=${now},t=${now - 86_400},v1=${digest}`,
    ])
      await expect(
        verifier.verify({ rawBody: encoder.encode(body), signature }),
      ).rejects.toThrow("Stripe webhook signature timestamp is malformed");
  });

  // Stripe's own check is one-sided (`now - t > tolerance`), so a future-dated
  // delivery never aged out of the window at all.
  it("denies a future-dated delivery beyond the tolerance", async () => {
    const verifier = new StripeWebhookVerifier(stripeSecret);
    const now = Math.floor(Date.now() / 1_000);

    await expect(
      verifier.verify({
        rawBody: encoder.encode(body),
        signature: signStripeWebhook(body, now + 299),
      }),
    ).resolves.toMatchObject({ eventId: "evt_clockwork_fixture" });
    await expect(
      verifier.verify({
        rawBody: encoder.encode(body),
        signature: signStripeWebhook(body, now + 3_600),
      }),
    ).rejects.toThrow("Stripe webhook timestamp is outside tolerance");
  });

  // A millisecond epoch in a second field is well-formed but lands in the year
  // 58000, which the one-sided SDK check could never reject.
  it("denies a `t=` in the wrong unit", async () => {
    await expect(
      new StripeWebhookVerifier(stripeSecret).verify({
        rawBody: encoder.encode(body),
        signature: signStripeWebhook(body, Date.now()),
      }),
    ).rejects.toThrow("Stripe webhook timestamp is outside tolerance");
  });
});

const marketplaceBody = (marketplace: string) =>
  JSON.stringify({ marketplace, providerEventId: "evt-310" });

/**
 * Stands in for any per-provider verifier: it authenticates the body with the
 * one secret it was constructed with, which is the property that makes routing
 * on the unverified provider claim safe.
 */
function secretBoundVerifier(secret: string): WebhookVerifier<unknown> {
  return {
    verify: (input) => {
      const expected = createHmac("sha256", secret)
        .update(input.rawBody)
        .digest();
      const supplied = Buffer.from(input.signature, "hex");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        return Promise.reject(new Error("Invalid webhook signature"));
      return Promise.resolve({
        eventId: "evt-310",
        occurredAt: "2026-08-01T12:00:00.000Z",
        payload: JSON.parse(new TextDecoder().decode(input.rawBody)) as unknown,
      });
    },
  };
}

const sign = (secret: string, body: string) =>
  createHmac("sha256", secret).update(encoder.encode(body)).digest("hex");

describe("provider-scoped webhook verification", () => {
  const awsSecret = "marketplace_secret_aws_310";
  const azureSecret = "marketplace_secret_azure_310";
  const verifier = new ProviderScopedWebhookVerifier(
    "marketplace",
    new Map([
      ["aws", secretBoundVerifier(awsSecret)],
      ["azure", secretBoundVerifier(azureSecret)],
    ]),
  );

  it("verifies each provider against its own secret", async () => {
    for (const [marketplace, secret] of [
      ["aws", awsSecret],
      ["azure", azureSecret],
    ] as const) {
      const body = marketplaceBody(marketplace);
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: sign(secret, body),
        }),
      ).resolves.toMatchObject({ eventId: "evt-310" });
    }
  });

  // With a single shared secret this succeeded: the signature proved only that
  // the holder of the one marketplace key signed it, never which marketplace.
  it("rejects one provider's key signing for another provider", async () => {
    const body = marketplaceBody("azure");

    await expect(
      verifier.verify({
        rawBody: encoder.encode(body),
        signature: sign(awsSecret, body),
      }),
    ).rejects.toThrow("Invalid webhook signature");
  });

  it("denies a provider that has no configured secret instead of falling back", async () => {
    const body = marketplaceBody("google");

    for (const secret of [awsSecret, azureSecret])
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: sign(secret, body),
        }),
      ).rejects.toThrow("No webhook secret is configured");
  });

  it("denies a body that claims no provider at all", async () => {
    for (const body of [
      "not json",
      "null",
      '"aws"',
      "{}",
      JSON.stringify({ marketplace: 7 }),
      JSON.stringify({ provider: "aws" }),
    ])
      await expect(
        verifier.verify({
          rawBody: encoder.encode(body),
          signature: sign(awsSecret, body),
        }),
      ).rejects.toThrow();
  });

  it("refuses to be constructed with no provider secrets at all", () => {
    expect(
      () => new ProviderScopedWebhookVerifier("marketplace", new Map()),
    ).toThrow("at least one configured provider secret");
  });
});
