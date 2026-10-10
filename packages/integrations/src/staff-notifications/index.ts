import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Where staff notifications go besides the in-app inbox: email and a Slack
 * channel. Both are optional and off until the deployment supplies their
 * settings, which are secrets and never stored in the database:
 *
 *   COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER     `ses`, or unset for no email
 *   COMMERCE_NOTIFICATIONS_EMAIL_FROM         the sender, `Name <address>`
 *   COMMERCE_NOTIFICATIONS_SES_REGION         defaults to AWS_REGION
 *   COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL  a Slack incoming webhook
 *
 * The SES adapter signs with the task role's credentials, so it needs no key.
 * A channel without its settings reports why and sends nothing; the guided
 * demo never sends.
 */

export type StaffDeliveryResult =
  | { ok: true; messageId: string | null }
  | { ok: false; kind: "transient" | "permanent"; code: string };

export interface StaffEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface StaffEmailPort {
  send(message: StaffEmailMessage): Promise<StaffDeliveryResult>;
}

export interface StaffSlackMessage {
  /** Slack mrkdwn: one short line, with a link. */
  text: string;
}

export interface StaffSlackPort {
  post(message: StaffSlackMessage): Promise<StaffDeliveryResult>;
}

/** Why a channel is not available, as a code the settings page explains. */
export type StaffChannelUnavailable =
  "not_configured" | "invalid_configuration" | "demo";

export type StaffChannel<Port> =
  | { configured: true; port: Port; target: string }
  | { configured: false; reason: StaffChannelUnavailable };

export interface StaffNotificationChannels {
  email: StaffChannel<StaffEmailPort>;
  slack: StaffChannel<StaffSlackPort>;
}

type Environment = Readonly<Record<string, string | undefined>>;

const SLACK_HOSTS = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);
const REQUEST_TIMEOUT_MS = 10_000;

function demo(env: Environment) {
  return (
    env.CLOCKWORK_EXPERIENCE_ADAPTER === "demo" ||
    env.CLOCKWORK_DEMO_DEPLOY === "1"
  );
}

/** `Name <address>` or a bare address, with one `@`. */
function senderAddress(from: string) {
  const match = /<([^<>\s]+)>\s*$/.exec(from);
  const address = match ? match[1] : from.trim();
  return address && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) ? address : null;
}

export function slackWebhookUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      SLACK_HOSTS.has(url.hostname) &&
      url.pathname.startsWith("/services/")
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * The channels this deployment can deliver to, read from its environment.
 * `createSes` and `fetch` are replaced in tests.
 */
export function staffNotificationChannels(
  env: Environment,
  options: {
    createSes?: (region: string | undefined) => SesSender;
    fetch?: typeof fetch;
  } = {},
): StaffNotificationChannels {
  if (demo(env))
    return {
      email: { configured: false, reason: "demo" },
      slack: { configured: false, reason: "demo" },
    };
  return {
    email: emailChannel(env, options),
    slack: slackChannel(env, options),
  };
}

function emailChannel(
  env: Environment,
  options: { createSes?: (region: string | undefined) => SesSender },
): StaffChannel<StaffEmailPort> {
  const provider = env.COMMERCE_NOTIFICATIONS_EMAIL_PROVIDER?.trim();
  if (!provider) return { configured: false, reason: "not_configured" };
  const from = env.COMMERCE_NOTIFICATIONS_EMAIL_FROM?.trim() ?? "";
  if (provider !== "ses" || !senderAddress(from))
    return { configured: false, reason: "invalid_configuration" };
  const region =
    env.COMMERCE_NOTIFICATIONS_SES_REGION?.trim() || env.AWS_REGION?.trim();
  const create = options.createSes ?? defaultSesSender;
  return {
    configured: true,
    target: senderAddress(from) ?? from,
    port: new SesStaffEmailAdapter(create(region), from),
  };
}

function slackChannel(
  env: Environment,
  options: { fetch?: typeof fetch },
): StaffChannel<StaffSlackPort> {
  const raw = env.COMMERCE_NOTIFICATIONS_SLACK_WEBHOOK_URL;
  if (!raw?.trim()) return { configured: false, reason: "not_configured" };
  const url = slackWebhookUrl(raw);
  if (!url) return { configured: false, reason: "invalid_configuration" };
  return {
    configured: true,
    target: url.hostname,
    port: new SlackWebhookAdapter(url, options.fetch ?? fetch),
  };
}

/** The one SES call the adapter makes, so tests need no AWS client. */
export interface SesSender {
  send(command: SendEmailCommand): Promise<{ MessageId?: string | undefined }>;
}

function defaultSesSender(region: string | undefined): SesSender {
  const client = new SESv2Client({
    ...(region ? { region } : {}),
    requestHandler: { requestTimeout: REQUEST_TIMEOUT_MS },
  });
  return { send: (command) => client.send(command) };
}

/** SES errors that pass with time: throttling and the daily sending quota. */
const transientSesErrors = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "LimitExceededException",
]);

/** SES errors that a retry cannot fix, the deployment's own credentials and
 * permissions among them. */
const permanentSesErrors = new Set([
  "CredentialsProviderError",
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "ExpiredTokenException",
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
  "SendingPausedException",
  "BadRequestException",
  "NotFoundException",
  "AccessDeniedException",
  "InvalidParameterValue",
  "ValidationException",
]);

export class SesStaffEmailAdapter implements StaffEmailPort {
  constructor(
    private readonly ses: SesSender,
    private readonly from: string,
  ) {}

  async send(message: StaffEmailMessage): Promise<StaffDeliveryResult> {
    try {
      const result = await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                Html: { Data: message.html, Charset: "UTF-8" },
              },
            },
          },
        }),
      );
      return { ok: true, messageId: result.MessageId ?? null };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const permanent =
        !transientSesErrors.has(name) &&
        (permanentSesErrors.has(name) ||
          (status !== undefined &&
            status >= 400 &&
            status < 500 &&
            status !== 429));
      return {
        ok: false,
        kind: permanent ? "permanent" : "transient",
        code: name ? `SES_${name}`.slice(0, 80) : "SES_UNAVAILABLE",
      };
    }
  }
}

export class SlackWebhookAdapter implements StaffSlackPort {
  constructor(
    private readonly url: URL,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async post(message: StaffSlackMessage): Promise<StaffDeliveryResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: message.text, unfurl_links: false }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, kind: "transient", code: "SLACK_UNAVAILABLE" };
    }
    if (response.ok) return { ok: true, messageId: null };
    // Slack answers 4xx for a revoked hook, an archived channel or a bad
    // payload; none of them improves with a retry. 429 and 5xx do.
    const transient = response.status === 429 || response.status >= 500;
    return {
      ok: false,
      kind: transient ? "transient" : "permanent",
      code: `SLACK_HTTP_${response.status}`,
    };
  }
}

/** Records what would have been sent. The integration and unit suites use it. */
export class FakeStaffEmail implements StaffEmailPort {
  readonly sent: StaffEmailMessage[] = [];
  private failures: ("transient" | "permanent")[] = [];

  failNext(kind: "transient" | "permanent") {
    this.failures.push(kind);
  }

  send(message: StaffEmailMessage): Promise<StaffDeliveryResult> {
    const failure = this.failures.shift();
    if (failure)
      return Promise.resolve({ ok: false, kind: failure, code: "FAKE_EMAIL" });
    this.sent.push(message);
    return Promise.resolve({ ok: true, messageId: `fake-${this.sent.length}` });
  }
}

export class FakeStaffSlack implements StaffSlackPort {
  readonly posted: StaffSlackMessage[] = [];
  private failures: ("transient" | "permanent")[] = [];

  failNext(kind: "transient" | "permanent") {
    this.failures.push(kind);
  }

  post(message: StaffSlackMessage): Promise<StaffDeliveryResult> {
    const failure = this.failures.shift();
    if (failure)
      return Promise.resolve({ ok: false, kind: failure, code: "FAKE_SLACK" });
    this.posted.push(message);
    return Promise.resolve({ ok: true, messageId: null });
  }
}
