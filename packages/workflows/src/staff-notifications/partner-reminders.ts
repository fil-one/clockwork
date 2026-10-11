import type { StaffNotificationStore } from "@clockwork/db";

/**
 * The daily partner reminder: every partner whose next step is due today or
 * overdue gets one `partner.next_step_due` event per due date, which the
 * staff notification handler turns into a notification for the partner's
 * owner. A partner overdue for a week is reminded once, on the first run
 * after its date; moving the date to a new day reminds again on that day.
 */
export interface PartnerReminderOptions {
  store: Pick<
    StaffNotificationStore,
    "partnerNextStepsToRemind" | "remindPartnerNextStep"
  >;
  /** Partners read per page; every page is read. */
  pageSize?: number;
  log?: (entry: Record<string, unknown>) => void;
}

const jsonLog = (entry: Record<string, unknown>) =>
  // i18n-exempt: operator log; identifiers and counts only
  console.log(JSON.stringify(entry));

const errorCode = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 200) : typeof error;

/**
 * `today` is the UTC calendar date of the scheduled run. Reads every partner
 * still to remind, page by page. One partner's failure is logged and the run
 * goes on; that partner is tried again on the next run.
 */
export async function remindPartnerNextSteps(
  today: string,
  options: PartnerReminderOptions,
) {
  const { log = jsonLog, pageSize = 200 } = options;
  let due = 0;
  let reminded = 0;
  let failed = 0;
  let after: { nextStepDue: string; partnerId: string } | undefined;
  for (;;) {
    const page = await options.store.partnerNextStepsToRemind({
      today,
      limit: pageSize,
      ...(after ? { after } : {}),
    });
    for (const row of page) {
      due += 1;
      try {
        if (await options.store.remindPartnerNextStep(row)) reminded += 1;
      } catch (error) {
        failed += 1;
        log({
          event: "PARTNER_NEXT_STEP_REMINDER_FAILED",
          partnerId: row.partnerId,
          error: errorCode(error),
        });
      }
    }
    const last = page.at(-1);
    if (page.length < pageSize || !last) break;
    after = { nextStepDue: last.nextStepDue, partnerId: last.partnerId };
  }
  log({ event: "PARTNER_NEXT_STEP_REMINDERS", today, due, reminded, failed });
  return { today, due, reminded, failed };
}

let configured: PartnerReminderOptions | undefined;

/** Called by the workflow runtime bootstrap. */
export function configurePartnerNextStepReminders(
  options: PartnerReminderOptions,
): void {
  configured = options;
}

/** One scheduled run; before the runtime is configured it does nothing and
 * says so, so the schedule never alarms. */
export async function runConfiguredPartnerNextStepReminders(
  scheduledAt: string,
) {
  const today = new Date(scheduledAt).toISOString().slice(0, 10);
  if (!configured) {
    jsonLog({
      event: "PARTNER_NEXT_STEP_REMINDERS_SKIPPED",
      reason: "runtime_not_configured",
    });
    return { today, skipped: true as const };
  }
  return remindPartnerNextSteps(today, configured);
}
