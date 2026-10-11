import { retryStaffNotificationDeliveries } from "./handler";

type RetryOptions = Parameters<typeof retryStaffNotificationDeliveries>[0];

let configured: RetryOptions | undefined;

/** Called by the workflow runtime bootstrap, with the handler's own store
 * and channels. */
export function configureStaffNotificationRetry(options: RetryOptions): void {
  configured = options;
}

/** One scheduled run. Before the runtime is configured there is nothing to
 * send; the run says so and succeeds, so the schedule never alarms. */
export async function runConfiguredStaffNotificationRetry(scheduledAt: string) {
  if (!configured) {
    // i18n-exempt: operator log; identifiers and codes only
    console.log(
      JSON.stringify({
        event: "STAFF_NOTIFICATION_RETRY_SKIPPED",
        reason: "runtime_not_configured",
      }),
    );
    return { scheduledAt, skipped: true as const };
  }
  return {
    scheduledAt,
    ...(await retryStaffNotificationDeliveries(configured)),
  };
}
