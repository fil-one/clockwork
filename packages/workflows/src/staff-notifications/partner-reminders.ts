import type { PartnerRepository, StaffNotificationStore } from "@clockwork/db";

/**
 * The daily partner reminder: every partner whose next step is due today or
 * overdue gets one `partner.next_step_due` event per due date, which the
 * staff notification handler turns into a notification for the partner's
 * owner. A partner overdue for a week is reminded once, on the first run
 * after its date; moving the date to a new day reminds again on that day.
 */
export interface PartnerReminderOptions {
  partners: Pick<PartnerRepository, "nextStepsDue">;
  store: Pick<StaffNotificationStore, "remindPartnerNextStep">;
  log?: (entry: Record<string, unknown>) => void;
}

const jsonLog = (entry: Record<string, unknown>) =>
  // i18n-exempt: operator log; identifiers and counts only
  console.log(JSON.stringify(entry));

/** `today` is the UTC calendar date of the scheduled run. */
export async function remindPartnerNextSteps(
  today: string,
  options: PartnerReminderOptions,
) {
  const { log = jsonLog } = options;
  const due = await options.partners.nextStepsDue({ through: today, today });
  let reminded = 0;
  for (const row of due) {
    // A partner with no owner has nobody to tell.
    if (!row.ownerId) continue;
    if (await options.store.remindPartnerNextStep(row)) reminded += 1;
  }
  log({
    event: "PARTNER_NEXT_STEP_REMINDERS",
    today,
    due: due.length,
    reminded,
  });
  return { today, due: due.length, reminded };
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
