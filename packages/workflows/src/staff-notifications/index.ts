import type {
  StaffDeliveryResult,
  StaffNotificationChannels,
} from "@clockwork/integrations";

import { testEmail, testSlackText } from "./messages";

export * from "./handler";
export * from "./messages";
export * from "./sources";

/** The portal origin email and Slack links point at, from the environment
 * the web process uses for its own absolute links. */
export function staffNotificationOrigin(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  for (const value of [env.CLOCKWORK_CANONICAL_ORIGIN, env.APP_ORIGIN]) {
    if (!value?.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === "https:" || url.protocol === "http:")
        return url.origin;
    } catch {
      // An unusable value falls through to the next.
    }
  }
  return null;
}

/**
 * Sends the settings page's test message on one channel. A channel that is
 * not configured says why and sends nothing.
 */
export async function sendStaffNotificationTest(
  channel: "email" | "slack",
  input: {
    channels: StaffNotificationChannels;
    origin: string | null;
    /** The administrator's own address, for the email test. */
    to: string;
  },
): Promise<
  StaffDeliveryResult | { ok: false; kind: "unavailable"; code: string }
> {
  if (channel === "email") {
    const email = input.channels.email;
    if (!email.configured)
      return { ok: false, kind: "unavailable", code: email.reason };
    return email.port.send({ to: input.to, ...testEmail(input.origin) });
  }
  const slack = input.channels.slack;
  if (!slack.configured)
    return { ok: false, kind: "unavailable", code: slack.reason };
  return slack.port.post({ text: testSlackText(input.origin) });
}
